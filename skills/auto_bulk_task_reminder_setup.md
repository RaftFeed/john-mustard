---
name: auto_bulk_task_reminder_setup
description: Parses multiple tasks with deadlines and configures a mix of specific one-time and recurring daily reminders for task management.
---

When a user provides a list of tasks or homework with deadlines and requests a specific reminder schedule: 1. Parse each item and use `addTodo` or `updateTodo`, calculating the `deadlineIso` based on the mentioned day. 2. Identify specific one-time reminders for individual tasks and use `addReminder` with the requested `remindAtIso`. 3. For requests to be reminded daily about remaining tasks, use `addReminder` with `recurrence: 'daily'`, ensuring the message summarizes the pending tasks to be tracked.
