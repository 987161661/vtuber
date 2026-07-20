import {
  ChatServiceFactory,
  type ChatService,
  type ChatServiceOptions,
} from '@aituber-onair/chat';

/** Creates a fresh service while preserving the factory's static registry receiver. */
export function createStatelessChatService(
  providerName: string,
  options: ChatServiceOptions,
): ChatService {
  const create = ChatServiceFactory.createChatService as (
    provider: string,
    serviceOptions: ChatServiceOptions,
  ) => ChatService;
  return create.call(ChatServiceFactory, providerName, options);
}
