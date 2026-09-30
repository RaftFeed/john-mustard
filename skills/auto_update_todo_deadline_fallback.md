---
name: auto_update_todo_deadline_fallback
description: Automatically falls back to searching and updating todo items when direct reminder update queries fail.
---

When updating a task or reminder time fails due to the agenda not being found, check `listReminders` and `listTodos` to locate the correct item, then execute `updateTodo` using the task query.
