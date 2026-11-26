# Uzum Pickup – high-fidelity prototype

SAD Coursework 2 (6BUIS026C). A working web prototype of Uzum Market's pickup point process with two new solutions based on the Coursework 1 analysis. Available in English, Uzbek and Russian.

## How to run

1. Open `index.html` in Chrome, Edge or Firefox. Nothing needs to be installed.
2. Operator PIN: **1234**. Seller password: **1234**.
3. The small dark **demo switcher** at the top centre changes between **Operator / Customer / Seller**, simulates an outage, turns **demo hints** (demo codes, PIN hints) on or off, and resets the data. Click **–** to shrink it to a dot.
4. The language (English / Oʻzbekcha / Русский) is chosen inside each app: operator sign-in and sidebar, customer top strip, seller sign-in and *My profile*.
5. **Reset demo** restores the starting data. Actions are saved in the browser, so all three views always show the same orders.

## The two solutions

**Solution 1 – Keep working when Uzum is down** (CW1 finding F2: about two days with no handovers during an outage)
- Every morning the pickup point saves an offline list of the orders waiting in its cells.
- During an outage the operator still checks codes and hands over orders from that list. Cash only, because the card terminal needs the network. Each code works once, even offline.
- Orders not in the list are refused with a clear message.
- On reconnecting, each queued action is sent once. Anything that changed online in the meantime, such as an order the customer cancelled, is flagged as a conflict and sent to Uzum Support.
- Screens: *Dashboard* (offline list card), *Hand over order* (offline mode), *Offline & sync*.

**Solution 2 – Proof of condition at every step** (CW1 findings F1 and F4: "not as described" disputes, careless repacking of returns)
- The item's condition is recorded with photos at three points: arrival at the pickup point (photo required if damaged), customer inspection, and return (photo always required).
- *Condition records* shows each order's records in time order and states where the problem started: before the pickup point, at inspection, at return, or a listing that does not match the product.
- Sellers see every return with its reason, photos and records, plus *Return insights* that flag products returned often for the same reason.

## Screens

| View | Screen |
|------|--------|
| Operator | Sign in, Dashboard, Receive parcels, Hand over order, Accept return, Offline & sync, Condition records |
| Customer | My orders page with tabs (All / Not paid / Active); each order card shows the pickup QR code, delivery line, pickup point, recipient, total, status history, refund status, condition records and products. Collapses to a mobile layout with a bottom bar on phones. |
| Seller | Sign-in page with interface language choice; admin panel with a dark sidebar: Orders, Returns (tabs by refund status, condition records in a side drawer), Analytics → Return insights, My profile (account details and interface language) |

## Code structure (matches the UML class diagram)

- `js/models.js` – domain classes. Generalisation: `User` → `Customer`, `Operator`, `Seller`; `SyncAction` → `HandoverAction`, `CashPaymentAction`, `ReturnAction`. Composition: `Order` ◆ `OrderLine`, `PickupCode`, `StatusEvent`, `ConditionRecord`; `OfflineCache` ◆ `OfflineEntry`. Aggregation: `PickupPoint` ◇ `StorageCell`. Enumerations: `OrderStatus`, `PaymentMethod`, `ReturnReason`, `EvidenceStage`, `SyncOutcome`.
- `js/services.js` – business logic. Interfaces with implementations: `NotificationChannel` (SMS, WhatsApp, Push), `RefundPolicy` (online card, counter card, cash, not charged), `PaymentGateway` (terminal). Services: `OfflineCacheService`, `SyncQueue`, `ConflictResolver`, `SyncService`, `ConnectionMonitor`, `PickupCodeVerifier`, `ParcelReceivingService`, `HandoverService`, `ReturnService`, `ReturnEligibilityChecker`, `RefundService`, `DisputeService`, `ReturnInsightService`, `DataStore`.
- `js/data.js` – demo data based on the Coursework 1 interviews and survey.
- `js/i18n.js` – interface text in English, Uzbek and Russian.
- `js/app.js` – presentation layer: renders the screens and passes user actions to the services.

## Suggested 1-minute video

Before recording: click **Reset demo**, then untick **Demo hints** so the screens look like a real product. Codes are typed by hand.

1. **0:00** Sign in (1234). Point to the two solution cards on the dashboard.
2. **0:05** *Solution 2:* Receive parcels → select UZ-10422 → Packaging damaged → add a photo → Receive. The cell tag appears.
3. **0:15** Condition records → UZ-10407: "Damage recorded before the customer saw it."
4. **0:22** *Solution 1:* Customer (Dilnoza) → order UZ-10398 → Show pickup code → Cancel order.
5. **0:28** Operator → **Simulate outage** (demo switcher) → Hand over order → type 615204 → Cash → Confirm. Type 615204 again: "cannot be used twice".
6. **0:40** **Restore connection** (demo switcher) → the Offline mode screen shows a conflict for UZ-10398.
7. **0:48** Seller → sign in (1234) → Returns → Condition records drawer → Analytics: the men's shirt is flagged.
8. **0:55** Seller → My profile → switch the interface language to Oʻzbek and Русский.
# UzumPickup-Prototype
