---
name: auto_update_reminder_by_recreation
description: Procedure to update a reminder or event title by listing, deleting the old entry, and creating a new one when direct update functions fail.
---

When a user wants to rename or modify an existing reminder/event and direct update fails: 1. Call `listReminders` to find the exact details and timing of the target item. 2. Call `deleteReminder` using the query or identifier of the old item. 3. Call `addReminder` with the updated title/message and the original timestamp.
