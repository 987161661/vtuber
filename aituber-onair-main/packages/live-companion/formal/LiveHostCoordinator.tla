------------------------ MODULE LiveHostCoordinator ------------------------
EXTENDS Naturals, Sequences

CONSTANTS MaxProactive, MaxPending

VARIABLES phase, active, pending, proactiveDelivered

Phases == {"offline", "observing", "deliberating", "speaking",
           "cooldown", "operator_hold", "recovering"}

Init == /\ phase = "offline"
        /\ active = FALSE
        /\ pending = 0
        /\ proactiveDelivered = 0

GoLive == /\ phase = "offline"
          /\ phase' = "observing"
          /\ UNCHANGED <<active, pending, proactiveDelivered>>

QueueTurn == /\ phase \notin {"offline", "operator_hold"}
             /\ pending < MaxPending
             /\ pending' = pending + 1
             /\ phase' = IF phase = "observing" THEN "deliberating" ELSE phase
             /\ UNCHANGED <<active, proactiveDelivered>>

StartTurn == /\ pending > 0
             /\ active' = TRUE
             /\ pending' = pending - 1
             /\ phase' = "speaking"
             /\ UNCHANGED proactiveDelivered

CompleteTurn == /\ phase = "speaking" /\ active
                /\ active' = FALSE
                /\ phase' = "cooldown"
                /\ UNCHANGED <<pending, proactiveDelivered>>

DeliverProactive == /\ proactiveDelivered < MaxProactive
                    /\ proactiveDelivered' = proactiveDelivered + 1
                    /\ UNCHANGED <<phase, active, pending>>

Takeover == /\ phase' = "operator_hold"
            /\ active' = FALSE
            /\ pending' = 0
            /\ UNCHANGED proactiveDelivered

GoOffline == /\ phase' = "offline"
             /\ active' = FALSE
             /\ pending' = 0
             /\ proactiveDelivered' = 0

Next == GoLive \/ QueueTurn \/ StartTurn \/ CompleteTurn \/
        DeliverProactive \/ Takeover \/ GoOffline

Spec == Init /\ [][Next]_<<phase, active, pending, proactiveDelivered>>

TypeOK == /\ phase \in Phases
          /\ active \in BOOLEAN
          /\ pending \in 0..MaxPending
          /\ proactiveDelivered \in 0..MaxProactive

OfflineQuiescent == phase = "offline" => (~active /\ pending = 0)
SpeakingHasActive == phase = "speaking" => active
ProactiveBound == proactiveDelivered <= MaxProactive

=============================================================================
