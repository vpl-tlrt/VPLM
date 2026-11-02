# Pickup Request Management — implementation plan

## Scope and safety
Feature branch: `feature/pickup-request-management`. Do not change existing Road Test status transitions, permission checks, vehicle assignment, reservations, Supabase sync, or other screens. New pickup screen must be available to all signed-in app roles. Keep a separate pickup record type, audit trail, and counters. No production merge until multi-user persistence and functional tests pass.

## Road Test KPI card-stack adjustment
Current pocket CSS uses a 5.35rem stage, 2.675rem cards and only 0.78rem vertical offset; most background cards are concealed. Increase stage and stack depth, spacing and offsets while preserving responsiveness, clickable cards and the expanded state. Validate desktop and mobile.

## Pickup request data contract
Record: id, vehicleId, plate snapshot, originLocationId, destinationType ('Workshop Bay' | 'Park Accommodation' | 'Reception for Delivery'), requestedWorkshopBayId, requestedBy, requestedAt, status ('Requested' | 'In Transit' | 'Completed' | 'Cancelled'), acceptedBy/At, completedBy/At, actualParkingLocationId, cancelledBy/At, cancellationReason, notes, revision.

## UX
- Navigation tab: **Pickup Requests** for every authenticated user.
- Search by plate or VIN, show matching parked vehicle cards and source parking location; select a vehicle.
- Requesting for: Workshop Bays (dropdown of eligible workshop bays), Park Accommodation, Reception for Delivery. Submit Request.
- Requests dashboard with source counts (reception, workshop, other), destination counts, pending and in-transit counters, stacked clickable cards, and request details.
- Requested card actions: Accept or Cancel. Accept records authenticated actor, marks In Transit, and checks vehicle is still parked at recorded origin.
- In Transit: only accepted actor (or authorized supervisor policy) can Finish / Complete Parking; prompt for actual final location, validate capacity and eligibility, then update vehicle location and movement history using existing app flow. Reject finish without destination.
- Completed and cancelled records are immutable. History and audit show timestamps, actor and source/destination.

## State machine and validation
Requested → In Transit → Completed; Requested → Cancelled; In Transit → Cancelled only with explicit rollback policy (never silently return a vehicle). One active pickup per vehicle. Avoid accepting if an active road test, already checked-out vehicle, delivered vehicle, or conflicting pickup exists. Use concurrency-safe updates (server-side compare-and-swap/version checks), not localStorage-only state.

## Integration and sync
Implement Supabase-backed shared pickup records with RLS, authenticated actor attribution, realtime/poll refresh, and offline pending queue only if safely supported by existing workspace-sync. Server must prevent two users accepting same request. Reuse existing vehicle movement/transfer logic only at verified finish, with capacity checks. Do not add a new entity to existing sync protocol without implementing and testing its server handler.

## Acceptance tests
1. All roles can view and create requests; unauthorized users cannot change other users' active transit.
2. Search, duplicate suppression, workshop dropdown, and all three destination types.
3. Pending counts and reception/workshop source classification; card opens details.
4. Two-user accept race allows exactly one acceptance.
5. Cancel and in-transit behavior; complete prompts for actual parking; no premature location change.
6. Bay occupancy/capacity, road-test conflicts, movement history and audit.
7. Mobile/desktop stacked cards visible and tappable.
8. Build/typecheck and verify cloud synchronization between devices; GitHub Pages deployment after approval gates.

## Status
Plan established; implementation and tests not yet completed. Keep production unchanged until gates pass.
