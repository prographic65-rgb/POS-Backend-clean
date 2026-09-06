# POS Backend - API Documentation

## Base URL

```
http://localhost:3000/api
```

## Authentication

Most endpoints require JWT authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

## Response Format

All responses follow this format:

```json
{
  "data": { /* response data */ },
  "statusCode": 200,
  "message": "Success"
}
```

Errors return:

```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "BadRequest"
}
```

---

## Endpoints

### Authentication

#### Register User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password",
  "name": "John Doe"
}
```

**Response:**

```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "employee",
    "isActive": true,
    "createdAt": "2026-03-09T15:30:00Z"
  }
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "employee",
    "isActive": true
  }
}
```

#### Get Profile (Protected)

```http
GET /auth/me
Authorization: Bearer <token>
```

---

### Categories

#### List All Categories

```http
GET /categories?skip=0&take=10
```

**Response:**

```json
[
  {
    "id": "uuid",
    "name": "Electronics",
    "description": "Electronic devices",
    "image": "url",
    "isActive": true,
    "createdAt": "2026-03-09T15:30:00Z",
    "updatedAt": "2026-03-09T15:30:00Z",
    "products": []
  }
]
```

#### Get Category by ID

```http
GET /categories/:id
```

#### Create Category (Protected)

```http
POST /categories
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Electronics",
  "description": "Electronic devices",
  "image": "url"
}
```

#### Update Category (Protected)

```http
PATCH /categories/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Category (Protected)

```http
DELETE /categories/:id
Authorization: Bearer <token>
```

---

### Products

#### List All Products

```http
GET /products?skip=0&take=10
```

**Response:**

```json
[
  {
    "id": "uuid",
    "name": "Laptop",
    "description": "High-performance laptop",
    "price": 999.99,
    "costPrice": 700.00,
    "stock": 50,
    "sku": "LAP-001",
    "barcode": "123456789",
    "image": "url",
    "isActive": true,
    "categoryId": "uuid",
    "category": { /* category object */ },
    "createdAt": "2026-03-09T15:30:00Z",
    "updatedAt": "2026-03-09T15:30:00Z"
  }
]
```

#### Get Product by ID

```http
GET /products/:id
```

#### Get Products by Category

```http
GET /products/category/:categoryId
```

#### Create Product (Protected)

```http
POST /products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Laptop",
  "description": "High-performance laptop",
  "price": 999.99,
  "costPrice": 700.00,
  "stock": 50,
  "sku": "LAP-001",
  "barcode": "123456789",
  "image": "url",
  "categoryId": "uuid"
}
```

#### Update Product (Protected)

```http
PATCH /products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "price": 1099.99,
  "stock": 45
}
```

#### Delete Product (Protected)

```http
DELETE /products/:id
Authorization: Bearer <token>
```

---

### Customers

#### List All Customers

```http
GET /customers?skip=0&take=10
```

**Response:**

```json
[
  {
    "id": "uuid",
    "name": "John Customer",
    "email": "john@example.com",
    "phone": "555-1234",
    "address": "123 Main St",
    "city": "New York",
    "postalCode": "10001",
    "country": "USA",
    "totalSpent": 5000.00,
    "isActive": true,
    "createdAt": "2026-03-09T15:30:00Z",
    "updatedAt": "2026-03-09T15:30:00Z"
  }
]
```

#### Get Customer by ID

```http
GET /customers/:id
```

#### Create Customer (Protected)

```http
POST /customers
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Customer",
  "email": "john@example.com",
  "phone": "555-1234",
  "address": "123 Main St",
  "city": "New York",
  "postalCode": "10001",
  "country": "USA"
}
```

#### Update Customer (Protected)

```http
PATCH /customers/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "555-5678",
  "address": "456 Oak Ave"
}
```

#### Delete Customer (Protected)

```http
DELETE /customers/:id
Authorization: Bearer <token>
```

---

### Orders

#### List All Orders

```http
GET /orders?skip=0&take=10
```

**Response:**

```json
[
  {
    "id": "uuid",
    "orderNumber": "ORD-1709993400000",
    "customerId": "uuid",
    "customer": { /* customer object */ },
    "createdById": "uuid",
    "createdBy": { /* user object */ },
    "status": "completed",
    "subtotal": 1999.98,
    "tax": 159.99,
    "discount": 0,
    "total": 2159.97,
    "notes": "order notes",
    "paymentMethod": "card",
    "createdAt": "2026-03-09T15:30:00Z",
    "updatedAt": "2026-03-09T15:30:00Z",
    "items": [
      {
        "id": "uuid",
        "productId": "uuid",
        "quantity": 2,
        "unitPrice": 999.99,
        "subtotal": 1999.98,
        "discount": 0,
        "total": 1999.98,
        "product": { /* product object */ }
      }
    ]
  }
]
```

#### Get Order by ID

```http
GET /orders/:id
```

#### Get Orders by Customer

```http
GET /orders/customer/:customerId
```

#### Create Order (Protected)

```http
POST /orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": "uuid",
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "unitPrice": 999.99
    }
  ],
  "tax": 159.99,
  "discount": 0,
  "notes": "order notes",
  "paymentMethod": "card"
}
```

#### Update Order (Protected)

```http
PATCH /orders/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "shipped",
  "notes": "updated notes"
}
```

Valid statuses: `pending`, `completed`, `cancelled`, `refunded`

#### Delete Order (Protected)

```http
DELETE /orders/:id
Authorization: Bearer <token>
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (Missing or invalid token) |
| 403 | Forbidden (No permission) |
| 404 | Not Found |
| 500 | Internal Server Error |

---

### Cashier Shifts

A **shift** is one cashier's window of accountability over a cash drawer. Every
payment settled while it is open is stamped onto it (`orders.shiftId`,
`orders.settledById`, `orders.settledAt`), so several cashiers can work the same
day and each hand over exactly what they collected.

Restaurant accounts only, and only once the owner sets `shiftsEnabled` on the
store. While the flag is off, settling still records **who** took the money but
nobody is blocked for lacking a drawer.

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| GET | `/shifts/current` | cashier | My open shift with live totals, or `null` |
| POST | `/shifts/open` | cashier | `{ openingFloat }`. 409 if shifts are off or one is already open |
| POST | `/shifts/:id/close` | own cashier, or owner | `{ countedCash, notes? }`. Freezes the figures |
| POST | `/shifts/:id/force-close` | owner | For a cashier who left without closing; variance stays unknown |
| POST | `/shifts/:id/collect` | owner | `{ collectedAmount, notes? }`. Confirms the cash was received |
| GET | `/shifts` | owner | `?status&userId&from&to` (+ paging) |
| GET | `/shifts/mine` | cashier | Own history |
| GET | `/shifts/:id` | own cashier, or owner | Shift, totals, **and the orders settled in it** |
| GET | `/shifts/me/dashboard` | cashier | `?from&to` — what this cashier collected, by payment method |
| GET | `/shifts/summary/by-cashier` | owner | `?from&to` — one row per cashier: takings, variance, still to collect |

**Reconciliation.** Only cash passes through the drawer:

```
expectedCash = openingFloat + cashSales − cashPaidOut
difference   = countedCash − expectedCash        (negative = short)
```

`cashPaidOut` comes from cash expenses booked by that cashier while their shift
was open. Card and online takings are reported but never handed over as notes.

Settling a restaurant order returns **409** when the tenant has shifts enabled
and the caller has no open drawer.

### Store Settings & Logo

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| PATCH | `/stores/:id/settings` | owner | `{ name?, address?, phone?, email?, shiftsEnabled? }`. `shiftsEnabled: true` is rejected for non-restaurant accounts |
| POST | `/stores/:id/logo` | owner | `multipart/form-data`, field `logo`. PNG/JPEG/WebP, max 500 KB. **413** if larger, **400** if another type |
| DELETE | `/stores/:id/logo` | owner | Removes the logo and clears `logoUrl` |
| GET | `/stores/:id/logo` | public (no token) | The image bytes with their content type. **Empty** 404 when there is none — never JSON, so an `<img>` is not blocked by the browser (ORB) |

`logoUrl` is server-relative (`/stores/<id>/logo?v=<ts>`); clients join it onto
their own API base URL. The bytes live in the database (`stores.logoData`,
never selected by other endpoints), because production runs on a container
whose disk is recreated on every deploy — logos written to `uploads/` vanished
at the next release. Rows from before that move still carry
`/uploads/logo/…`; those paths answer an empty 404 until the owner uploads
again.

`GET /auth/me` additionally returns `storeName`, `logoUrl` and `shiftsEnabled`,
so clients do not have to fetch the store to render an identity or decide
whether the till requires a shift.

### Restaurant order lifecycle

```
draft → requested → preparing → handed_over → completed
```

- **`handed_over`** is the KITCHEN's terminal state: cooked and passed to the
  floor. The order is still unpaid and still holds its table.
- `PATCH /restaurant/orders/:id/status` accepts only `preparing` and
  `handed_over`, and validates the transition (409 otherwise). The kitchen
  cannot set `completed` — that means paid and table freed, which only
  settling may do.
- `handed_over` is simply what the cashier's screen highlights as ready to
  bill; billing itself is allowed from any live status, because a takeaway or
  delivery is billed the moment it is ordered.

- `DELETE /restaurant/orders/:id/draft` (waiter, cashier, owner) discards a
  draft outright — it reserved no table and took no money, so nothing is kept.
  **409** once the order has been sent to the kitchen; that is the cashier's
  cancel.

**Drinks never reach the kitchen.** A line whose product sits in a category
that is flagged `skipKitchen`, or is named *Drinks*/*Beverages*, is stamped
`skipKitchen: true` on the order line. Such lines are billed like any other
but are left off kitchen tickets, and an order (or a further round) made only
of them never goes on the kitchen board: it opens straight in `handed_over`,
and a drinks-only round on a finished order leaves it there. `orderCreated`
is still emitted (the till needs it); `orderItemsAdded` is emitted only when
the round contains something to cook, with `newItems` holding just those lines.

**Dine-in versus dine-out is derived.** A seated order is `dine_out` when any
line has `isParcel: true` and `dine_in` otherwise, whatever type the client
sent; adding a parcel line in a later round upgrades the order.

### Billing: print first, then pay

Taking payment is two calls, matching how a restaurant works — the bill goes
to the customer first, the money is booked when it arrives:

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| POST | `/restaurant/orders/:id/print-bill` | cashier, owner | `{ discountType?, discountValue?, riderName? }`. Fixes the discount, stamps `billPrintedById`/`billPrintedAt`, and **claims** the order for the caller. `riderName` is required on a delivery (**400**) and printed on the bill. Calling again is a reprint — the only way to change the discount |
| POST | `/restaurant/orders/:id/settle` | cashier, owner | `{ paymentMethod?, split? }`. **409** until the bill is printed. Charges the printed figure (older clients may still send discount fields). Completes the order, frees the table, stamps the shift |

**Split payments.** `paymentMethod: 'partial'` with
`split: { cash?, card?, online? }` records a customer paying by more than one
method. The amounts must add up to the bill to the cent (**400** otherwise);
a split that turns out to be one method is stored as that method. Every paid
order carries `paidCash` / `paidCard` / `paidOnline` (the whole total on one
column for a single method) and, when partial, a `paymentSplit` object. Shift
totals and the cashier dashboard sum those columns, so a split lands in each
bucket separately — which is what lets the cashier hand the owner an exact
per-method figure at the end of the shift.
| POST | `/restaurant/orders/:id/cancel` | cashier, owner | Same claim rule as settle |

**The claim.** Until a bill is printed, every cashier sees the order. Once
printed, `GET /restaurant/orders` for a *cashier* omits it unless they printed
it (`billPrintedById IS NULL OR = caller`), and reprint/settle/cancel by another
cashier return **403** naming who holds it. Owners always see and may act on
everything. A waiter adding a round to a printed bill clears the claim and the
discount, and the order goes back in front of every cashier to be printed again.

Responses carry `billPrinted`, `billPrintedByName`, `billPrintedAt` and
`riderName`. `GET /restaurant/orders` also accepts `billPrinted=true|false`.
"Bill printed" is a display state on the clients, not a member of
`orderStatus` — the kitchen lifecycle is untouched by billing.

**Order types**: `dine_in`, `dine_out`, `takeaway`, `delivery`. `dine_out` is a
dine-in order that also takes a parcel home — it requires a table exactly like
`dine_in`, and individual lines are flagged with `isParcel` so the kitchen
knows what to box. One receipt covers both.

---

## Pagination

List endpoints support pagination:

```
?skip=0&take=10
```

- `skip` - Number of records to skip (default: 0)
- `take` - Number of records to return (default: 10)
