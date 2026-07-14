package local.aituber.gateway;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import tech.ordinaryroad.live.chat.client.bilibili.client.BilibiliLiveChatClient;
import tech.ordinaryroad.live.chat.client.bilibili.config.BilibiliLiveChatClientConfig;
import tech.ordinaryroad.live.chat.client.bilibili.listener.IBilibiliMsgListener;
import tech.ordinaryroad.live.chat.client.codec.bilibili.constant.ProtoverEnum;
import tech.ordinaryroad.live.chat.client.codec.bilibili.msg.*;
import tech.ordinaryroad.live.chat.client.commons.base.msg.*;
import tech.ordinaryroad.live.chat.client.commons.client.IBaseLiveChatClient;
import tech.ordinaryroad.live.chat.client.commons.client.enums.ClientStatusEnums;
import tech.ordinaryroad.live.chat.client.douyu.client.DouyuLiveChatClient;
import tech.ordinaryroad.live.chat.client.douyu.config.DouyuLiveChatClientConfig;
import tech.ordinaryroad.live.chat.client.douyu.listener.IDouyuMsgListener;
import tech.ordinaryroad.live.chat.client.codec.douyu.msg.*;
import tech.ordinaryroad.live.chat.client.huya.client.HuyaLiveChatClient;
import tech.ordinaryroad.live.chat.client.huya.config.HuyaLiveChatClientConfig;
import tech.ordinaryroad.live.chat.client.huya.listener.IHuyaMsgListener;
import tech.ordinaryroad.live.chat.client.codec.huya.msg.*;
import tech.ordinaryroad.live.chat.client.douyin.client.DouyinLiveChatClient;
import tech.ordinaryroad.live.chat.client.douyin.config.DouyinLiveChatClientConfig;
import tech.ordinaryroad.live.chat.client.douyin.listener.IDouyinMsgListener;
import tech.ordinaryroad.live.chat.client.codec.douyin.msg.*;
import tech.ordinaryroad.live.chat.client.kuaishou.client.KuaishouLiveChatClient;
import tech.ordinaryroad.live.chat.client.kuaishou.config.KuaishouLiveChatClientConfig;
import tech.ordinaryroad.live.chat.client.kuaishou.listener.IKuaishouMsgListener;
import tech.ordinaryroad.live.chat.client.codec.kuaishou.msg.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * One JVM host for every OrdinaryRoad platform connection. Stdout is a
 * credential-free JSON-lines protocol consumed by the local Node gateway.
 */
public final class OrdinaryRoadBridge {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final AtomicLong EVENT_SEQUENCE = new AtomicLong();
  private final Map<String, Connection> connections = new ConcurrentHashMap<>();

  private record Connection(
      String id,
      String platform,
      String roomId,
      IBaseLiveChatClient<?, ?> client
  ) {}

  public static void main(String[] args) throws Exception {
    OrdinaryRoadBridge host = new OrdinaryRoadBridge();
    Runtime.getRuntime().addShutdownHook(new Thread(host::shutdown));
    host.run();
  }

  private void run() throws Exception {
    emit("bridge-ready", Map.of(
        "connectorId", "ordinaryroad",
        "ordinaryroadVersion", "1.5.8"
    ));
    try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) continue;
        try {
          handleCommand(JSON.readValue(line, new TypeReference<>() {}));
        } catch (Exception error) {
          emitError("command-invalid", error);
        }
      }
    }
  }

  private void handleCommand(Map<String, Object> command) throws Exception {
    String action = string(command.get("action"));
    String commandId = string(command.get("commandId"));
    if ("connect".equals(action)) {
      connect(
          required(command, "connectionId"),
          required(command, "platform"),
          required(command, "roomId"),
          string(command.get("cookie"))
      );
      return;
    }
    if ("disconnect".equals(action)) {
      disconnect(required(command, "connectionId"));
      return;
    }
    if ("send".equals(action) && !commandId.isBlank()) {
      send(required(command, "connectionId"), commandId, required(command, "message"));
      return;
    }
    throw new IllegalArgumentException("unsupported_command");
  }

  private void connect(String connectionId, String platform, String roomId, String cookie) {
    disconnect(connectionId);
    IBaseLiveChatClient<?, ?> client = createClient(connectionId, platform, roomId, cookie);
    Connection connection = new Connection(connectionId, platform, roomId, client);
    connections.put(connectionId, connection);
    client.addStatusChangeListener((event, previous, current) -> emit("connection", Map.of(
        "connectionId", connectionId,
        "platform", platform,
        "roomId", roomId,
        "state", statusName(current)
    )));
    client.connect(
        () -> emit("connection", Map.of(
            "connectionId", connectionId,
            "platform", platform,
            "roomId", roomId,
            "state", "online"
        )),
        error -> emit("connection", Map.of(
            "connectionId", connectionId,
            "platform", platform,
            "roomId", roomId,
            "state", "error",
            "error", safeError(error)
        ))
    );
  }

  private void disconnect(String connectionId) {
    Connection previous = connections.remove(connectionId);
    if (previous == null) return;
    try {
      previous.client().destroy();
    } catch (Exception ignored) {}
    emit("connection", Map.of(
        "connectionId", connectionId,
        "platform", previous.platform(),
        "roomId", previous.roomId(),
        "state", "disabled"
    ));
  }

  private void send(String connectionId, String commandId, String message)
      throws InterruptedException {
    Connection connection = connections.get(connectionId);
    if (connection == null) throw new IllegalArgumentException("connection_not_found");
    CountDownLatch completed = new CountDownLatch(1);
    AtomicReference<Throwable> failure = new AtomicReference<>();
    connection.client().sendDanmu(
        message.trim(),
        completed::countDown,
        error -> {
          failure.set(error);
          completed.countDown();
        }
    );
    if (!completed.await(20, TimeUnit.SECONDS)) {
      emit("send-result", Map.of(
          "commandId", commandId,
          "connectionId", connectionId,
          "ok", false,
          "error", "ordinaryroad_send_timeout"
      ));
      return;
    }
    Throwable error = failure.get();
    emit("send-result", error == null
        ? Map.of("commandId", commandId, "connectionId", connectionId, "ok", true)
        : Map.of(
            "commandId", commandId,
            "connectionId", connectionId,
            "ok", false,
            "error", safeError(error)
        ));
  }

  private IBaseLiveChatClient<?, ?> createClient(
      String connectionId,
      String platform,
      String roomId,
      String cookie
  ) {
    return switch (platform) {
      case "bilibili" -> createBilibili(connectionId, roomId, cookie);
      case "douyu" -> createDouyu(connectionId, roomId, cookie);
      case "huya" -> createHuya(connectionId, roomId, cookie);
      case "douyin" -> createDouyin(connectionId, roomId, cookie);
      case "kuaishou" -> createKuaishou(connectionId, roomId, cookie);
      default -> throw new IllegalArgumentException("unsupported_platform:" + platform);
    };
  }

  private void configure(tech.ordinaryroad.live.chat.client.commons.client.config.BaseLiveChatClientConfig config,
                         String roomId, String cookie) {
    config.setRoomId(roomId);
    config.setCookie(cookie);
    config.setAutoReconnect(true);
    config.setReconnectDelay(5);
    config.setMinSendDanmuPeriod(1600L);
  }

  private BilibiliLiveChatClient createBilibili(String id, String room, String cookie) {
    BilibiliLiveChatClientConfig config = new BilibiliLiveChatClientConfig();
    configure(config, room, cookie);
    config.setProtover(ProtoverEnum.NORMAL_ZLIB);
    return new BilibiliLiveChatClient(config, new IBilibiliMsgListener() {
      public void onDanmuMsg(DanmuMsgMsg msg) { publishDanmu(id, "bilibili", room, msg, "comment"); }
      public void onGiftMsg(SendGiftMsg msg) { publishGift(id, "bilibili", room, msg); }
      public void onSuperChatMsg(SuperChatMessageMsg msg) { publishDanmu(id, "bilibili", room, msg, "superchat"); }
      public void onEnterRoomMsg(InteractWordMsg msg) { publishEntry(id, "bilibili", room, msg); }
      public void onLikeMsg(LikeInfoV3ClickMsg msg) { publishLike(id, "bilibili", room, msg); }
      public void onLiveStatusMsg(BilibiliLiveStatusChangeMsg msg) { publishLiveStatus(id, "bilibili", room, msg); }
      public void onRoomStatsMsg(BilibiliRoomStatsMsg msg) { publishStats(id, "bilibili", room, msg); }
    });
  }

  private DouyuLiveChatClient createDouyu(String id, String room, String cookie) {
    DouyuLiveChatClientConfig config = new DouyuLiveChatClientConfig();
    configure(config, room, cookie);
    return new DouyuLiveChatClient(config, new IDouyuMsgListener() {
      public void onDanmuMsg(ChatmsgMsg msg) { publishDanmu(id, "douyu", room, msg, "comment"); }
      public void onGiftMsg(DgbMsg msg) { publishGift(id, "douyu", room, msg); }
      public void onSuperChatMsg(CommChatmsgMsg msg) { publishDanmu(id, "douyu", room, msg, "superchat"); }
      public void onEnterRoomMsg(UenterMsg msg) { publishEntry(id, "douyu", room, msg); }
    });
  }

  private HuyaLiveChatClient createHuya(String id, String room, String cookie) {
    HuyaLiveChatClientConfig config = new HuyaLiveChatClientConfig();
    configure(config, room, cookie);
    return new HuyaLiveChatClient(config, new IHuyaMsgListener() {
      public void onDanmuMsg(MessageNoticeMsg msg) { publishDanmu(id, "huya", room, msg, "comment"); }
      public void onGiftMsg(SendItemSubBroadcastPacketMsg msg) { publishGift(id, "huya", room, msg); }
      public void onEnterRoomMsg(VipEnterBannerMsg msg) { publishEntry(id, "huya", room, msg); }
    });
  }

  private DouyinLiveChatClient createDouyin(String id, String room, String cookie) {
    DouyinLiveChatClientConfig config = new DouyinLiveChatClientConfig();
    configure(config, room, cookie);
    return new DouyinLiveChatClient(config, new IDouyinMsgListener() {
      public void onDanmuMsg(DouyinDanmuMsg msg) { publishDanmu(id, "douyin", room, msg, "comment"); }
      public void onGiftMsg(DouyinGiftMsg msg) { publishGift(id, "douyin", room, msg); }
      public void onEnterRoomMsg(DouyinEnterRoomMsg msg) { publishEntry(id, "douyin", room, msg); }
      public void onLikeMsg(DouyinLikeMsg msg) { publishLike(id, "douyin", room, msg); }
      public void onLiveStatusMsg(DouyinControlMsg msg) { publishLiveStatus(id, "douyin", room, msg); }
      public void onRoomStatsMsg(DouyinRoomStatsMsg msg) { publishStats(id, "douyin", room, msg); }
    });
  }

  private KuaishouLiveChatClient createKuaishou(String id, String room, String cookie) {
    KuaishouLiveChatClientConfig config = new KuaishouLiveChatClientConfig();
    configure(config, room, cookie);
    return new KuaishouLiveChatClient(config, new IKuaishouMsgListener() {
      public void onDanmuMsg(KuaishouDanmuMsg msg) { publishDanmu(id, "kuaishou", room, msg, "comment"); }
      public void onGiftMsg(KuaishouGiftMsg msg) { publishGift(id, "kuaishou", room, msg); }
      public void onLikeMsg(KuaishouLikeMsg msg) { publishLike(id, "kuaishou", room, msg); }
      public void onRoomStatsMsg(KuaishouRoomStatsMsg msg) { publishStats(id, "kuaishou", room, msg); }
    });
  }

  private void publishDanmu(String id, String platform, String room, IDanmuMsg msg, String type) {
    publishEvent(id, platform, room, type, msg.getUid(), msg.getUsername(), msg.getUserAvatar(),
        msg.getContent(), Map.of("badgeName", string(msg.getBadgeName()), "badgeLevel", msg.getBadgeLevel()));
  }

  private void publishGift(String id, String platform, String room, IGiftMsg msg) {
    publishEvent(id, platform, room, "gift", msg.getUid(), msg.getUsername(), msg.getUserAvatar(),
        string(msg.getGiftName()) + " x" + msg.getGiftCount(), Map.of(
            "giftName", string(msg.getGiftName()),
            "giftCount", msg.getGiftCount(),
            "giftPrice", msg.getGiftPrice()
        ));
  }

  private void publishEntry(String id, String platform, String room, IEnterRoomMsg msg) {
    publishEvent(id, platform, room, "entry", msg.getUid(), msg.getUsername(), msg.getUserAvatar(), "", Map.of());
  }

  private void publishLike(String id, String platform, String room, ILikeMsg msg) {
    publishEvent(id, platform, room, "like", msg.getUid(), msg.getUsername(), msg.getUserAvatar(),
        "点赞", Map.of("clickCount", msg.getClickCount()));
  }

  private void publishStats(String id, String platform, String room, IRoomStatsMsg msg) {
    emit("room-stats", Map.of(
        "connectionId", id,
        "platform", platform,
        "roomId", room,
        "onlineCount", parseLong(msg.getWatchingCount()),
        "likedCount", string(msg.getLikedCount()),
        "watchedCount", string(msg.getWatchedCount())
    ));
  }

  private void publishLiveStatus(String id, String platform, String room, ILiveStatusChangeMsg msg) {
    emit("live-status", Map.of(
        "connectionId", id,
        "platform", platform,
        "roomId", room,
        "isLive", string(msg.getLiveStatusAction()).toLowerCase().contains("start")
    ));
  }

  private void publishEvent(
      String connectionId, String platform, String roomId, String type,
      String uid, String username, String avatar, String text, Map<String, Object> metadata
  ) {
    long timestamp = System.currentTimeMillis();
    String identity = connectionId + ':' + uid + ':' + type + ':' + text + ':'
        + timestamp + ':' + EVENT_SEQUENCE.incrementAndGet();
    Map<String, Object> author = new LinkedHashMap<>();
    author.put("id", string(uid));
    author.put("name", string(username));
    if (avatar != null && !avatar.isBlank()) author.put("avatarUrl", avatar);
    Map<String, Object> eventMetadata = new LinkedHashMap<>();
    eventMetadata.put("connectorId", "ordinaryroad");
    eventMetadata.put("connectionId", connectionId);
    eventMetadata.put("platformId", platform);
    eventMetadata.put("sourcePlatform", platform);
    eventMetadata.put("roomId", roomId);
    eventMetadata.putAll(metadata);
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", platform + ':' + sha256(identity).substring(0, 24));
    event.put("type", type);
    event.put("text", string(text));
    event.put("timestamp", timestamp);
    event.put("author", author);
    event.put("metadata", eventMetadata);
    emit("room-event", Map.of("connectionId", connectionId, "event", event));
  }

  private void shutdown() {
    for (Connection connection : connections.values()) {
      try { connection.client().destroy(); } catch (Exception ignored) {}
    }
    connections.clear();
  }

  private static String statusName(ClientStatusEnums status) {
    return switch (status) {
      case CONNECTED -> "online";
      case CONNECTING -> "connecting";
      case RECONNECTING -> "reconnecting";
      case CONNECT_FAILED -> "error";
      case DISCONNECTED, DESTROYED -> "disabled";
      default -> status.name().toLowerCase();
    };
  }

  private static synchronized void emit(String kind, Map<String, ?> payload) {
    try {
      Map<String, Object> envelope = new LinkedHashMap<>();
      envelope.put("kind", kind);
      envelope.put("at", Instant.now().toEpochMilli());
      envelope.putAll(payload);
      System.out.println(JSON.writeValueAsString(envelope));
      System.out.flush();
    } catch (Exception error) {
      System.err.println("bridge_serialization_failed:" + safeError(error));
    }
  }

  private static void emitError(String kind, Throwable error) {
    emit(kind, Map.of("error", safeError(error)));
  }

  private static String safeError(Throwable error) {
    if (error == null) return "unknown_error";
    String value = (error.getClass().getSimpleName() + ':' + string(error.getMessage()))
        .replaceAll("(?i)((?:SESSDATA|bili_jct|cookie)\\s*[:=]\\s*)[^;\\s,}]+", "$1[REDACTED]");
    return value.substring(0, Math.min(1000, value.length()));
  }

  private static String required(Map<String, Object> values, String name) {
    String value = string(values.get(name)).trim();
    if (value.isBlank()) throw new IllegalArgumentException("missing_" + name);
    return value;
  }

  private static String string(Object value) { return value == null ? "" : String.valueOf(value); }
  private static long parseLong(Object value) {
    try { return Long.parseLong(string(value)); } catch (Exception ignored) { return 0L; }
  }
  private static String sha256(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder output = new StringBuilder();
      for (byte item : digest) output.append(String.format("%02x", item));
      return output.toString();
    } catch (Exception error) { throw new IllegalStateException(error); }
  }
}
