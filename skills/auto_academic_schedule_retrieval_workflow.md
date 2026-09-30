---
name: auto_academic_schedule_retrieval_workflow
description: A multi-step retrieval process to find exam or academic schedules by checking reminders, notes, and todo lists sequentially when a direct keyword search fails.
---

When asked for a specific schedule (like UTS/UAS) and a direct note lookup fails, execute the following: 1. Call listReminders to check for immediate calendar events. 2. If not found, call listTodos with includeRoutine=true. 3. Parse the output for keywords related to the requested exam/schedule. 4. Present the filtered list of relevant exam tasks clearly to the user.
