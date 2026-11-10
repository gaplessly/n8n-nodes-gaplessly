# n8n-nodes-gaplessly

This is an n8n community node. It lets you automate your own [Gaplessly](https://gaplessly.com) account in n8n: bookings, availability, guests, and your venue's tables, services and staff, plus an instant trigger for booking and guest changes.

Gaplessly is booking software for restaurants, bars and appointment businesses such as salons. Each business has one of two booking engines: table reservations (hospitality) or appointments. The node reads which one your account uses and sends the right request.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources) · [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install `n8n-nodes-gaplessly`.

## Operations

**Gaplessly** (action node)

| Resource | Operations |
| --- | --- |
| Availability | Check free times for a local date, party size (tables) or service and staff member (appointments) |
| Booking | Create, Update (time, party size, notes), Cancel, Get Many (a local date range) |
| Booking, table reservations only | Update Status (seated, completed, no-show, undo a seat), Move Table, Seat Walk-In (a party nobody booked, seated now), Record Check (a till check total for guest spend; never charges anything), Get Checks |
| Event | Get a booking, guest or till check event by its ID, as Gaplessly sent it (kept 30 days) |
| Guest | Find (by email, or phone compared by digits), Get Many |
| Organization | Get |
| Service, Staff Member | Get Many (appointments) |
| Table, Service Period | Get Many (table reservations) |

**Gaplessly Trigger** starts a workflow when a booking is created, updated or cancelled, a guest is created or merged, or (table reservations) a till check opens or changes. Activating the workflow registers a webhook on your account; deactivating it removes the webhook.

## Credentials

1. In Gaplessly, open **Developer** and create an API key. Choose **Test (sandbox)** first: a test key reaches a private sandbox copy of your setup, never your real bookings, and sends no guest emails or texts.
2. Tick only the scopes your workflow needs: `organization:read` always; `availability:read` to check times; `reservations:read` and `reservations:write` (tables) or `appointments:read` and `appointments:write` (appointments) for bookings; `tables:read`, `services:read`, `providers:read` or `service-periods:read` for those lists; `clients:read` for guests; `webhooks:write` for the trigger (with `reservations:read` for till check events).
3. In n8n, create a **Gaplessly API** credential and paste the key. n8n tests it against your organization.

Switch to a live key when the workflow does what you expect.

## Compatibility

Built with `@n8n/node-cli` 0.55 against `n8n-workflow` 2.x. Tested on n8n 2.46.

## Usage

- **Times.** Enter start times in the business's own local time, `YYYY-MM-DDTHH:MM`, with no UTC offset. Pick one from **Availability > Check**.
- **Retries never double-book.** **Booking > Create** needs a **Source Event ID**: a stable ID from whatever started the booking (a form submission, an order). Running the node again with the same ID returns the first booking instead of making a second. Use a new ID for each booking you intend.
- **Payment rules hold.** If a booking needs a deposit or a card, nothing is booked. The node fails with a link the guest can use to finish online.
- **Booking ID vs event ID.** In a trigger payload, the booking is `data.object.id`. The top-level `id` is the event.
- **Signed events.** Every delivery is signed (`Gaplessly-Signature`, HMAC-SHA256 over the raw body). The trigger refuses anything unsigned, altered or more than five minutes old, and runs each event once even if Gaplessly retries it.
- **Errors** carry Gaplessly's own message and code, for example `insufficient_scope` when the key lacks a scope.

### Example: email the manager when a large party books

Gaplessly Trigger (Booking Created) → IF `{{$json.data.object.partySize}}` is larger than 7 → Send Email.

### Example: book from a form

Form Trigger → Gaplessly (Availability > Check) → Gaplessly (Booking > Create) with Source Event ID set to the form submission's ID.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Gaplessly integrations guide](https://gaplessly.com/docs/integrations)
- [Gaplessly API reference](https://gaplessly.com/docs)

## Version history

- **0.1.0**: first release. Every endpoint of the Gaplessly API v1 for both booking engines, including walk-ins and till checks, and a signed instant trigger for booking, guest and till check events.
