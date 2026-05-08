# Kaban TUI — Specification

> Terminal Kanban for AI Code Agents

## Overview

Kaban is a TUI kanban board designed for collaborative use between humans and AI coding agents (Claude Code, Codex CLI, Aider, etc.). Agents can programmatically manage tasks while humans observe and interact through the same board.

---

## Core Principles

1. **Agent-first, human-friendly** — Structured data for agents, visual interface for humans
2. **Multi-agent safe** — Concurrent access without corruption
3. **Minimal friction** — Simple CLI, intuitive TUI, standard MCP tools
4. **Portable** — Single SQLite file, works anywhere

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Interfaces                          │
├───────────────┬───────────────┬─────────────────────────┤
│     TUI       │      CLI      │       MCP Server        │
│   (OpenTUI)   │   (commands)  │     (agent tools)       │
│   Human view  │  Human/Agent  │      Agent-only         │
└───────┬───────┴───────┬───────┴───────────┬─────────────┘
        │               │                   │
        └───────────────┼───────────────────┘
                        ▼
            ┌───────────────────────┐
            │      @kaban/core      │
            │   (business logic)    │
            └───────────┬───────────┘
                        ▼
            ┌───────────────────────┐
            │   SQLite + Drizzle    │
            │   (.kaban/board.db)   │
            └───────────────────────┘
```

### Packages

| Package | Purpose |
|---------|---------|
| `@kaban/core` | Business logic, database, types |
| `@kaban/cli` | Command-line interface |
| `@kaban/tui` | Terminal UI (OpenTUI + React) |
| `@kaban/mcp` | MCP server for agents |

---

## Data Model

### Task

A task represents a step in an agent's plan or a human-created work item.

```typescript
interface Task {
  id: string;              // ULID for sortability
  title: string;           // Short description
  description?: string;    // Detailed notes (markdown)
  columnId: string;        // Current column
  position: number;        // Order within column

  // Ownership
  createdBy: string;       // Agent ID or "user"
  assignedTo?: string;     // Who's working on it

  // Dependencies
  parentId?: string;       // Parent task (for subtasks)
  dependsOn: string[];     // Must complete before this starts

  // Context
  files: string[];         // Related file paths
  labels: string[];        // Tags for filtering
  blockedReason?: string;  // Why task is stuck

  // Tracking
  version: number;         // Optimistic locking
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
```

### Column

```typescript
interface Column {
  id: string;
  name: string;
  position: number;        // Order on board
  wipLimit?: number;       // Max tasks in column (optional)
  isTerminal: boolean;     // Tasks here are "done"
}
```

### Board

```typescript
interface Board {
  id: string;
  name: string;
  columns: Column[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Default Columns

```json
{
  "board": {
    "name": "Kaban Board"
  },
  "columns": [
    { "id": "backlog", "name": "Backlog" },
    { "id": "todo", "name": "Todo" },
    { "id": "in_progress", "name": "In Progress", "wipLimit": 3 },
    { "id": "review", "name": "Review", "wipLimit": 2 },
    { "id": "done", "name": "Done", "isTerminal": true }
  ],
  "defaults": {
    "column": "todo",
    "agent": "user"
  },
  "sync": {
    "todoWrite": {
      "pending": "todo",
      "inProgress": "in_progress",
      "completed": "done",
      "cancelled": "backlog"
    }
  }
}
```

`columns` order defines board order at initialization and is kept in sync by the `kaban columns` CLI. Column IDs are stable references used by tasks and commands; display names can be renamed. `defaults.column` is the fallback for task creation and next-task selection when no column is supplied. `sync.todoWrite` maps Claude Code TodoWrite statuses to board column IDs. Older configs without `sync.todoWrite` are upgraded in place when the current CLI reads them. If the configured default column or a mapped TodoWrite column is deleted, Kaban chooses a remaining compatible column and updates the config. Terminal columns represent completed work.

---

## Persistence

### Storage

- **Primary:** SQLite database at `.kaban/board.db`
- **Config:** JSON at `.kaban/config.json`
- **Export:** JSON snapshot via `kaban export`

### Concurrency

**Optimistic locking** via `version` field:

1. Read task with current `version`
2. Attempt update with `WHERE version = ?`
3. If 0 rows affected → conflict, re-read and retry or fail

```sql
UPDATE tasks
SET column_id = ?, version = version + 1, updated_at = ?
WHERE id = ? AND version = ?
```

### File Structure

```
.kaban/
├── board.db          # SQLite database
├── config.json       # Board configuration
└── exports/          # JSON snapshots
    └── 2026-01-16.json
```

---

## CLI Interface

### Commands

```bash
# Board management
kaban init                          # Initialize board in current directory
kaban status                        # Show board summary

# Task operations
kaban add "Task title"              # Add to configured default column
kaban add "Title" --column backlog  # Add to specific column
kaban add "Title" --agent claude    # Add as agent
kaban add "Title" --depends-on 3,5  # Add with dependencies

kaban show <id>                     # Show task details
kaban edit <id>                     # Edit task (opens $EDITOR)
kaban move <id> <column>            # Move task to column
kaban move <id> --next              # Move to next column
kaban move <id> <column> --force    # Move ignoring WIP limit
kaban assign <id> <agent>           # Assign task
kaban block <id> "reason"           # Mark as blocked
kaban unblock <id>                  # Clear blocked status
kaban done <id>                     # Move to done column
kaban delete <id>                   # Remove task
kaban delete <id> --cascade         # Remove task and subtasks

# Listing & filtering
kaban list                          # List all tasks
kaban list --column todo            # Filter by column
kaban list --agent claude           # Filter by agent
kaban list --blocked                # Show blocked tasks
kaban list --json                   # Output as JSON

# Column operations
kaban columns list                  # List columns with task counts, metadata, and roles
kaban columns add qa "QA"           # Add a column at the end
kaban columns add qa "QA" --before done --wip-limit 2
kaban columns rename todo "Ready"   # Rename without changing the ID
kaban columns move review --after qa
kaban columns update done --terminal
kaban columns update qa --clear-wip-limit
kaban columns delete qa             # Delete an empty column

# Dependencies
kaban deps <id>                     # Show task dependencies
kaban deps <id> --add 3             # Add dependency
kaban deps <id> --remove 3          # Remove dependency

# Export
kaban export                        # Export to JSON
kaban export --file backup.json     # Export to specific file

# TUI
kaban                               # Launch TUI (default)
kaban tui                           # Launch TUI (explicit)
```

### Agent Identity

```bash
# Default: tasks created by "user"
kaban add "Fix bug"

# Explicit agent
kaban add "Fix bug" --agent claude-code

# Via environment variable
export KABAN_AGENT=claude-code
kaban add "Fix bug"
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Task not found |
| 3 | Conflict (optimistic lock failure) |
| 4 | Validation error |

### Error Handling

#### CLI Errors

| Scenario | Exit Code | Message |
|----------|-----------|---------|
| Task not found | 2 | `Task '{id}' not found` |
| Optimistic lock conflict | 3 | `Task modified by another agent, re-read required` |
| Invalid column | 4 | `Column '{name}' does not exist` |
| WIP limit exceeded | 4 | `Column '{name}' at WIP limit ({n}/{limit})` |
| Circular dependency | 4 | `Circular dependency detected: {chain}` |
| Invalid task ID format | 4 | `Invalid task ID: '{id}'` |
| Dependency not found | 4 | `Dependency task '{id}' not found` |

#### Database Errors

| Scenario | Behavior |
|----------|----------|
| DB locked | Retry 3x with exponential backoff (100ms, 200ms, 400ms), then fail |
| DB corrupted | Exit code 1, message: `Database corrupted. Restore from export: kaban import <file>` |
| Disk full | Fail operation, preserve existing state, exit code 1 |
| DB not initialized | Exit code 1, message: `No board found. Run 'kaban init' first` |

#### Hook Errors

| Scenario | Behavior |
|----------|----------|
| Hook command fails | Log warning, continue operation (hooks don't block) |
| Hook timeout | Kill after 5s, log warning, continue |
| Hook not found | Log warning on first occurrence, continue |

---

## Behaviors

### Dependency Enforcement

```
Given: Task [B] depends on Task [A]
When: User moves Task [B] to "in_progress"
And: Task [A] is NOT in a terminal column
Then: Move succeeds
And: Task [B] is auto-marked as blocked
And: blockedReason set to "Waiting for dependency: [A] {title}"
```

```
Given: Task [B] depends on Task [A]
And: Task [B] is blocked due to dependency
When: Task [A] moves to terminal column (done)
Then: Task [B] is auto-unblocked
And: blockedReason is cleared
```

### WIP Limit Enforcement

```
Given: Column "in_progress" has wipLimit: 3
And: Column contains 3 tasks
When: User moves Task [4] to "in_progress"
Then: Move is REJECTED
And: Exit code 4
And: Message: "Column 'In Progress' at WIP limit (3/3). Move a task out first."
```

```
Given: Column "in_progress" has wipLimit: 3
And: Column contains 3 tasks
When: User moves Task [4] to "in_progress" with --force flag
Then: Move succeeds (WIP limit is advisory with --force)
And: Warning logged: "WIP limit exceeded in 'In Progress' (4/3)"
```

### Optimistic Lock Conflict

```
Given: Task [1] exists at version 5
When: Agent A reads Task [1] (version 5)
And: Agent B updates Task [1] (now version 6)
And: Agent A attempts update with version 5
Then: Update REJECTED
And: Exit code 3
And: Message includes current task state for review
```

### Circular Dependency Prevention

```
Given: Task [A] depends on Task [B]
When: User adds dependency: Task [B] depends on Task [A]
Then: Operation REJECTED
And: Exit code 4
And: Message: "Circular dependency detected: [A] → [B] → [A]"
```

```
Given: Task [A] → [B] → [C] (dependency chain)
When: User adds dependency: Task [C] depends on Task [A]
Then: Operation REJECTED
And: Message: "Circular dependency detected: [A] → [B] → [C] → [A]"
```

### Task Deletion Cascade

```
Given: Task [B] depends on Task [A]
When: User deletes Task [A]
Then: Task [A] is deleted
And: Task [B].dependsOn removes reference to [A]
And: If Task [B] was blocked only by [A], it is unblocked
```

```
Given: Task [A] is parent of subtask [A.1]
When: User deletes Task [A]
Then: Deletion REJECTED
And: Exit code 4
And: Message: "Cannot delete task with subtasks. Delete subtasks first or use --cascade"
```

```
Given: Task [A] is parent of subtask [A.1]
When: User deletes Task [A] with --cascade
Then: Task [A.1] is deleted
And: Task [A] is deleted
```

### Undo Behavior

```
Given: User deletes Task [1]
When: User runs "kaban undo"
Then: Task [1] is restored with original data
And: Task [1] gets new version number
And: Message: "Restored: [1] {title}"
```

```
Given: Undo history contains 20 operations
And: Undo retention is 50 operations (default)
When: User performs 31st operation
Then: Oldest undo entry is discarded
```

Undoable operations: `add`, `delete`, `move`, `edit`, `block`, `unblock`, `assign`
NOT undoable: `init`, `export`, `undo` itself

---

## Input Validation

### Limits

| Field | Min | Max | Notes |
|-------|-----|-----|-------|
| Task title | 1 | 200 | Required, trimmed |
| Task description | 0 | 10,000 | Optional, markdown |
| Column name | 1 | 50 | Required |
| Agent name | 1 | 50 | Alphanumeric, hyphens, underscores |
| Label | 1 | 30 | Alphanumeric, hyphens |
| File path | 1 | 500 | Relative paths only, no validation of existence |
| Dependencies | 0 | 20 | Max dependencies per task |
| Columns | 2 | 20 | Board must have at least 2 columns |

### ID Format

- **Task ID**: ULID (26 characters, e.g., `01ARZ3NDEKTSV4RRFFQ69G5FAV`)
- **Column ID**: lowercase alphanumeric + underscores (e.g., `in_progress`)

### Agent Name Rules

```
Valid:   user, claude-code, agent_1, GPT4
Invalid: "my agent" (spaces), @claude (special chars), "" (empty)
Regex:   ^[a-zA-Z][a-zA-Z0-9_-]{0,49}$
```

---

## MCP Server

### Tools

```typescript
// Task management
kaban_add_task(title, column?, agent?, dependsOn?)
kaban_move_task(id, column)
kaban_update_task(id, updates)
kaban_complete_task(id)
kaban_delete_task(id)
kaban_block_task(id, reason)
kaban_unblock_task(id)

// Querying
kaban_list_tasks(filters?)
kaban_get_task(id)
kaban_get_blocked_tasks()
kaban_get_dependencies(id)

// Board info
kaban_get_board()
kaban_get_columns()
```

### Resources

```typescript
// MCP resources for read-only access
kaban://board          # Full board state
kaban://tasks          # All tasks
kaban://task/{id}      # Single task
kaban://blocked        # Blocked tasks
```

---

## TUI Interface

### Layout

```
┌─ Kaban ─────────────────────────────────────────────────────────────┐
│ Backlog (2)  │ Todo (3)     │ In Progress (2/3) │ Review │ Done (5) │
├──────────────┼──────────────┼───────────────────┼────────┼──────────┤
│              │              │                   │        │          │
│ [1] Research │ [3] Add API  │ [5] Write tests   │        │ [8] ...  │
│              │     ⛓️ →1     │     @claude       │        │ [9] ...  │
│ [2] Design   │              │                   │        │          │
│              │ [4] Update   │ [6] Fix auth      │        │          │
│              │     ⛓️ →3     │     ⚠️ blocked     │        │          │
│              │              │     @user         │        │          │
└──────────────┴──────────────┴───────────────────┴────────┴──────────┘
│ Task: [5] Write tests                                                │
│ Agent: claude │ Depends on: [1] Research (✓)                         │
│ Files: src/auth.ts, src/auth.test.ts                                 │
├──────────────────────────────────────────────────────────────────────┤
│ [h/l] move │ [j/k] navigate │ [a]dd │ [d]one │ [b]lock │ [?] help   │
└──────────────────────────────────────────────────────────────────────┘
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `h` / `l` | Move task left/right (between columns) |
| `j` / `k` | Navigate up/down within column |
| `H` / `L` | Switch focus between columns |
| `Enter` | Open task detail panel |
| `a` | Add new task |
| `e` | Edit selected task |
| `d` | Mark as done |
| `b` | Toggle blocked status |
| `x` | Delete task (with confirmation) |
| `/` | Search/filter |
| `D` | Toggle dependency view |
| `S` | Toggle swimlanes (group by agent) |
| `?` | Show help |
| `q` | Quit |

### Visual Indicators

| Symbol | Meaning |
|--------|---------|
| `⛓️ →N` | Depends on task N |
| `⚠️` | Blocked |
| `@name` | Assigned to agent/user |
| `(2/3)` | WIP count / limit |
| `✓` | Dependency satisfied |

### Dependency View (Toggle with `D`)

```
┌─ Dependencies ──────────────────────────────────────────────────────┐
│                                                                      │
│  [1] Research ✓                                                      │
│   └──► [3] Add API                                                   │
│         └──► [4] Update docs                                         │
│         └──► [5] Write tests ← YOU ARE HERE                          │
│                                                                      │
│  [2] Design                                                          │
│   └──► [6] Fix auth ⚠️ blocked                                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### .kaban/config.json

```json
{
  "board": {
    "name": "My Project"
  },
  "columns": [
    { "id": "backlog", "name": "Backlog" },
    { "id": "todo", "name": "Todo" },
    { "id": "in_progress", "name": "In Progress", "wipLimit": 3 },
    { "id": "review", "name": "Review" },
    { "id": "done", "name": "Done", "isTerminal": true }
  ],
  "defaults": {
    "column": "todo",
    "agent": "user"
  },
  "display": {
    "showCompleted": true,
    "completedLimit": 10,
    "theme": "default"
  }
}
```

---

## Implementation Phases

### Phase 1: Core + CLI
- [ ] Set up monorepo with Bun workspaces
- [ ] Implement `@kaban/core` with SQLite/Drizzle
- [ ] Build CLI with basic commands (add, list, move, done)
- [ ] Optimistic locking

### Phase 2: TUI
- [ ] OpenTUI + React setup
- [ ] Board layout with columns
- [ ] Keyboard navigation
- [ ] Task detail panel
- [ ] Dependency indicators

### Phase 3: MCP Server
- [ ] MCP server setup
- [ ] Task management tools
- [ ] Query tools
- [ ] Resources

### Phase 4: Polish
- [ ] Dependency graph view
- [ ] Search/filter
- [ ] Themes
- [ ] JSON export/import
- [ ] Documentation

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| TUI | OpenTUI + @opentui/react |
| Database | SQLite + Drizzle ORM |
| CLI | Commander.js or built-in Bun |
| MCP | @modelcontextprotocol/sdk |
| IDs | ULID (sortable, unique) |

---

## Additional Features

### Auto-Archive
Completed tasks auto-archive after configurable days (default: 7).

```json
{
  "archive": {
    "enabled": true,
    "afterDays": 7
  }
}
```

### Undo
Support undo for destructive operations via operation log.

```bash
kaban undo              # Undo last operation
kaban undo --list       # Show undo history
```

### Hooks
Event hooks for task state changes.

```json
{
  "hooks": {
    "onTaskComplete": "notify-send 'Task done: ${title}'",
    "onTaskBlocked": null
  }
}
```

Events: `onTaskCreate`, `onTaskMove`, `onTaskComplete`, `onTaskDelete`, `onTaskBlocked`, `onTaskUnblocked`

### Swimlanes (Toggle)
Group tasks by agent in horizontal rows. Default: off. Press `S` to toggle.

```
┌─────────────┬─ Todo ────────┬─ In Progress ─┬─ Done ─────────┐
│   claude    │ [1] Fix auth  │ [4] Tests     │ [5] Setup      │
├─────────────┼───────────────┼───────────────┼────────────────┤
│   user      │ [2] Write docs│ [3] Add API   │ [6] Init       │
└─────────────┴───────────────┴───────────────┴────────────────┘
```

---

*Spec version: 0.3.0*
*Last updated: 2026-01-16*
