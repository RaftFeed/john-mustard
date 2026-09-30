---
name: auto_save_and_forward_payment_instruction
description: Saves bank account details as a persistent note and forwards the transfer request to a designated contact via direct message.
---

When the user provides bank details and requests a transfer to be handled by another person: 1. Call `saveNote` to store the account information (norek, bank, name) using a descriptive key. 2. Call `sendDirectMessage` to the specified recipient with a clear instruction to perform the transfer, including the saved account details.
