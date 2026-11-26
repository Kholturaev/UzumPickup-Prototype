# Uzum Pickup – high-fidelity prototype

## How to run

1. Open `index.html` in Chrome, Edge or Firefox. Nothing needs to be installed.
2. Operator PIN: **1234**. Seller password: **1234**.
3. The small dark **demo switcher** at the top centre changes between **Operator / Customer / Seller**, simulates an outage, turns **demo hints** (demo codes, PIN hints) on or off, and resets the data. Click **–** to shrink it to a dot.
4. The language (English / Oʻzbekcha / Русский) is chosen inside each app: operator sign-in and sidebar, customer top strip, seller sign-in and *My profile*.
5. **Reset demo** restores the starting data. Actions are saved in the browser, so all three views always show the same orders.

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
