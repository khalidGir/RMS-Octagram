# Product Requirements Document (PRD)

**Project Name:** All-in-One Restaurant Management & POS System  
**Document Version:** 1.0  
**Target Delivery Window:** MVP (4-6 Weeks)

---

## 1. Executive Summary & Vision

The objective of this platform is to provide a flexible, multi-tenant SaaS solution for restaurant management and point-of-sale (POS) operations. Designed to accommodate various service models (dine-in, takeout, and pickup), the platform features customizable module toggles that allow restaurant owners to tailor functionality to their operational needs.

---

## 2. User Roles & Access Control

| Role | Access & Key Responsibilities |
| :--- | :--- |
| **Super Admin** | Platform-level management; multi-tenant provisioning; toggling tenant modules on or off. |
| **Owner / Manager** | Restaurant-level oversight; menu management; inventory and batch configuration; analytics dashboard. |
| **Cashier** | POS interface; order intake; payment processing (cash, manual transfer, and card); order status routing. |
| **Kitchen Staff** | Kitchen Display System (KDS); order queue handling; status updates (In Progress, Ready, and Completed). |
| **Customer** | Table QR or remote digital ordering interface; order tracking; optional payment gateway checkout. |

---

## 3. Key Feature Modules & Requirements

### 3.1 Session & Ordering Management

- **Dine-In Session Tracking:**
  - Table-specific QR codes act as unique session IDs.
  - Allows table-linked ordering and bill splitting or merging.
  - The session persists until the order is settled and closed.
- **Remote / Pickup Orders:**
  - A dedicated ordering flow requires customer contact details and a selected pickup time slot.
- **Cashier POS Interface:**
  - Supports direct order creation, order editing, and manual payment verification for cash and wire transfers.

### 3.2 Kitchen Display System (KDS) & Workflow

- **Order Routing:** Routes confirmed orders to the kitchen display in real time.
- **Status Pipeline:** `Confirmed` -> `In Progress` -> `Ready` -> `Completed`.
- **Queue Optimization:** Displays the estimated preparation time for each order, with bump and recall capabilities for order management.
- **Status Updates:** Provides real-time feedback to customer and POS interfaces when an order's status changes.

### 3.3 Inventory & Batch Management

- **Batch Portioning Model:**
  - Bulk inventory (for example, 20 kg of meat) is registered as pre-portioned units (for example, 70 burger portions).
- **Automated Deduction:**
  - Successful order confirmations automatically deduct mapped batch portions from inventory.
- **Threshold Alerts:**
  - Managers can configure low-stock alert thresholds.

### 3.4 Analytics & Reporting (MVP Scope)

- Daily and date-range total revenue tracking.
- Best-selling menu item and sales-volume analysis.
- Peak operational hours tracking.
- Inventory depletion and consumption logs.

---

## 4. Multi-Tenant Modularity Framework

To support different restaurant operating models, the Super Admin can toggle individual system modules for each tenant:

- Payment Gateway Integration (ON / OFF)
- Self-Service Table QR Ordering (ON / OFF)
- Kitchen Display System (ON / OFF)
- Batch Inventory Tracking (ON / OFF)
