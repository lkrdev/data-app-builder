---
name: looker-permissions
description: Mental model, permission hierarchy, model-set-to-project expansion rules, folder ACLs, role-denied 404 diagnostics, and per-tool capability gating for Looker extensions and Data App Studio (Data Apps, Content Studio, Agentic LookML, 3-Pillar Health Check, Python Tile, and /config). Use when evaluating, debugging, or implementing Looker role/permission checks, model filtering, project access, or capability-gated UI workflows.
---

# Looker Permissions & Capability Gating Skill

Use this skill whenever you need to reason about, diagnose, or implement Looker authorization across roles, model sets, LookML projects, folders, and instance feature flags.

---

## 1. The 4-Layer Looker Authorization Mental Model

Every operation in Looker is governed by the intersection of **four independent layers**. A check that only verifies permission names without checking model sets, project expansion, or folder `can` flags will produce false positives or runtime 404s.

```
Effective Capability =
  (1) Role Permission (Instance-Wide OR Model-Scoped via Role = PermissionSet × ModelSet)
  ∩ (2) Model-to-Project / Model-to-Connection Expansion (for LookML IDE & SQL Runner)
  ∩ (3) Folder Content ACL (folder.can.edit_content / view for Dashboards & Looks)
  ∩ (4) Instance Feature Flags & Mount Context (e.g., inline_extensions, SSO embed limits)
```

### Layer 1: `Role = PermissionSet × ModelSet`
A Looker user has one or more `Role` objects (`GET /api/4.0/users/{user_id}/roles` / `sdk.user_roles({ user_id })`).
Each `Role` binds a **Permission Set** (`role.permission_set.permissions`, `all_access`) to a **Model Set** (`role.model_set.models`, `all_access`).

> **Critical Evaluation Rule (No Cross-Role Bleeding):**
> Never union all permissions across all roles and multiply them by all models across all roles.
> If Role A grants `explore` on `["ecommerce"]` and Role B grants `develop` on `["hr"]`, the user can **develop** `"hr"` and **explore** `"ecommerce"`, NOT develop `"ecommerce"`!
> Always evaluate `permissions × models` **per role first**, then union the model sets per permission across roles.

#### A. Instance-Wide Permissions
If present in **any** of the user's roles (or if any role has `permission_set.all_access === true` or `"admin"`), these apply globally across the entire Looker instance:
- **Content & Authoring**: `save_content`, `save_dashboards`, `save_looks`, `create_table_calculations`, `create_custom_fields`, `can_override_vis_config`, `create_public_looks`, `download_with_limit`, `download_without_limit`, `schedule_without_limit`
- **Git & Deployment**: `deploy` (requires `develop`), `manage_models`
- **Platform & Governance**: `see_system_activity`, `see_pdts`, `see_datagroups`, `see_schedules`, `see_queries`, `see_logs`, `see_users`, `manage_spaces`, `manage_user_attributes`, `see_admin`, `admin`

#### B. Model-Specific Permissions
These apply **strictly** to the `models` in the `model_set` of the specific role that grants that permission (unless `role.model_set.all_access === true` or the user has `manage_models` / `admin`):
- **Viewing & Querying**: `access_data`, `see_looks`, `see_user_dashboards`, `see_lookml_dashboards`, `explore`, `see_sql`, `clear_cache_refresh`
- **LookML & SQL Runner**: `see_lookml`, `develop`, `use_sql_runner`, `manage_project_models`, `use_global_connections`
- **Scheduling & Delivery**: `schedule_look_emails`, `schedule_external_look_emails`, `send_to_s3`, `send_to_sftp`, `send_outgoing_webhook`, `send_to_integration`

---

### Layer 2: The Model-to-Project & Model-to-Connection Expansion Rules

Looker's role system assigns `develop`, `see_lookml`, `manage_project_models`, and `use_sql_runner` on a **Model Set**, even though the LookML IDE (`/projects/{project_id}/*`) and SQL Runner (`/sql_queries`) operate on **Projects** and **Connections**.

#### Rule 2A: Model-to-Project Expansion (`develop`, `see_lookml`, `manage_project_models`)
From Looker's official RBAC specification:
- Because a model belongs to a LookML project (`LookmlModel.project_name`), if a user has `develop` (or `see_lookml` / `manage_project_models`) on **at least one model** in project `P`, Looker grants that permission across **all LookML files and models in project `P`**.
- **Formula**:
  $$\text{Projects}(\text{perm}) = \{ M.\text{project\_name} \mid M \in \text{all\_lookml\_models}, \, M.\text{name} \in \text{Models}(\text{perm}) \}$$
  *(If the user has `manage_models`, `admin`, or a role with `perm` and `model_set.all_access === true`, they have `perm` on **all** projects.)*
- **Important Asymmetry**: Although `develop` on one model in project `P` lets the user edit every `.model.lkml` and `.view.lkml` file in project `P` (and run `validate_project(P)`), the user can still **only run queries** (`run_inline_query`, `create_query`, `lookml_model_explore`) against the specific models in their `access_data` / `explore` model sets!

#### Rule 2B: Model-to-Connection Expansion (`use_sql_runner`)
- If a user has `use_sql_runner` on model `M`, they can run raw SQL queries (`create_sql_query`, `run_sql_query`) against the database connection(s) allowed by `M` (`M.allowed_db_connection_names`).

---

### Layer 3: Folder Content Access (`Folder.can`)
Even when a user holds `save_content` + `save_dashboards` (or `save_looks`), saving or updating a dashboard/Look inside folder `F` requires folder-level **Manage Access, Edit** permission:
- **View content in folder**: `folder.can?.index === true` or `folder.can?.show === true` (returned by `all_folders`)
- **Create/Edit dashboards or Looks in folder**: `folder.can?.edit_content === true` or `folder.can?.save_content === true` (note: a user's `personal_folder_id` always grants edit access if they have `save_content`).
- **Update existing dashboard `D`**: `dashboard.can?.update === true`

---

### Layer 4: Instance Feature Flags & Looker's "Role-Denied 404" Quirk
Looker's internal `authorize!` helper returns **HTTP 404** (not HTTP 403) when a user lacks a required permission, which looks identical at the HTTP status layer to an unmounted route or disabled feature flag (such as `inline_extensions` being disabled on `/data_app_extension`).

**How to distinguish Role-Denied 404 from Feature-Disabled 404:**
| Signal | Role-Denied HTTP 404 (Missing Permission) | Feature-Disabled HTTP 404 (`inline_extensions` off) |
|---|---|---|
| Response body | JSON `{"message": "Not found", "documentation_url": "..."}` | HTML/text `Sinatra::NotFound` or JSON with bare root URL |
| `documentation_url` | Contains `/r/err/` (e.g., `https://docs.looker.com/r/err/4.0/404/...`) | Bare root `"https://docs.looker.com/"` or absent |
| Remediation | Grant the missing Looker permission/model in **Admin > Roles** | Enable `inline_extensions` feature flag on the Looker instance |

---

## 2. Looker Permission Dependency Hierarchy

When configuring or diagnosing custom Looker roles, parent permissions are required before child permissions can function:

```
access_data (Model-Specific root)
└── see_looks (Model-Specific)
    ├── see_user_dashboards (Model-Specific)
    ├── see_lookml_dashboards (Model-Specific)
    ├── explore (Model-Specific)
    │   ├── save_content (Instance-Wide)
    │   │   ├── save_dashboards (Instance-Wide)
    │   │   └── save_looks (Instance-Wide)
    │   ├── create_table_calculations (Instance-Wide)
    │   ├── create_custom_fields (Instance-Wide)
    │   └── can_override_vis_config (Instance-Wide)
    ├── see_lookml (Model-Specific → expands to Project)
    │   └── use_sql_runner (Model-Specific → expands to Model's Connections)
    │       └── see_sql (Model-Specific)
    ├── develop (Model-Specific → expands to Project)
    │   ├── deploy (Instance-Wide)
    │   └── manage_project_models (Model-Specific → expands to Project)
    │       └── use_global_connections (Model-Specific)
    └── schedule_look_emails (Model-Specific)
        └── schedule_external_look_emails (Model-Specific)
```

---

## 3. Exact Permission Matrix by Tool (`data-app-builder`)

### Tool 1: Data App (`/app/:id?`)
Builds and publishes interactive Lit web-component applications packaged as Looker inline extensions (`db::<uuid>`) mounted on full-bleed User-Defined Dashboards (`type: "extension"`).

| Action | Model-Scoped Permissions (on target Explore's model) | Instance-Wide Permissions | Folder / Resource / Feature Requirements | SDK / REST Endpoints Invoked |
|---|---|---|---|---|
| **View Published Data App** | `access_data`, `see_looks`, `see_user_dashboards` | — | Folder **View** access + `inline_extensions` feature flag enabled | `GET /dashboards/{id}`, `GET /inline_extension/{id}/bundle.js`, `POST /queries/run/{fmt}` |
| **Explore Schema & Dry-Run Queries** | `access_data`, `see_looks`, `explore` | — | — | `all_lookml_models`, `lookml_model_explore`, `run_inline_query`, `search_content` |
| **Publish / Update Data App** | `access_data`, `see_looks`, `see_user_dashboards`, `explore` | `save_content`, `save_dashboards` *(Does **NOT** require `develop`!)* | Folder **Edit** access (`folder.can.edit_content`) + `inline_extensions` enabled | `POST /queries`, `POST/PATCH /data_app_extension`, `POST/PATCH /dashboards`, `POST/PATCH /dashboard_elements`, `PATCH /dashboard_layout_components` |

---

### Tool 2: Content Studio (`/dashboard/:id?`)
Builds and updates both **User-Defined Dashboards (UDDs)** and **LookML Dashboards (`.dashboard.lookml`)**, as well as Saved Looks, Boards, and Scheduled Plans via `LkrCodeMode`.

| Sub-Capability | Model-Scoped Permissions (on queried model) | Instance-Wide Permissions | Folder / Project / Resource Requirements | SDK Endpoints Invoked |
|---|---|---|---|---|
| **UDD Dashboards (`dashboard`)** | `access_data`, `see_looks`, `see_user_dashboards`, `explore` | `save_content`, `save_dashboards` | Folder **Edit** access (`folder.can.edit_content`) | `create_query`, `create_dashboard`, `update_dashboard`, `create_dashboard_element`, `create_dashboard_filter`, `update_dashboard_layout` |
| **LookML Dashboards (`lookml_dashboard` — `.dashboard.lookml`)** | `access_data`, `see_lookml_dashboards`, `explore` (on queried model) + `develop` on **≥1 model** in target `project_id` | — (`deploy` if deploying to prod) | **Model → Project Expansion**: `develop` on any model in Project `P` unlocks creating/editing `*.dashboard.lookml` and `*.model.lkml` (`include: "*.dashboard.lookml"`) in Project `P` | `update_session({ workspace_id: "dev" })`, `create_file`, `update_file`, `validate_project`, `dashboard("model::name")` |
| **LookML ↔ UDD Import / Sync** | `access_data`, `see_lookml_dashboards`, `see_user_dashboards` | `save_content`, `save_dashboards` | Folder **Edit** access (`folder.can.edit_content`) | `import_lookml_dashboard`, `sync_lookml_dashboard` |
| **Saved Looks (`look`)** | `access_data`, `see_looks`, `explore` | `save_content`, `save_looks` | Folder **Edit** access (`folder.can.edit_content`) | `create_query`, `create_look`, `update_look` |
| **Boards (`board`)** | `access_data`, `see_looks`, `see_user_dashboards` (or `see_lookml_dashboards`) | — | Board edit ownership | `create_board`, `create_board_section`, `create_board_item` |
| **Schedules** | `access_data`, `see_looks`, plus at least one delivery perm (`schedule_look_emails`, `schedule_external_look_emails`, `send_to_s3`, `send_to_sftp`, `send_outgoing_webhook`, `send_to_integration`) | `schedule_without_limit` (only if `send_all_results: true`) | Access to target UDD, LookML Dashboard, or Look | `create_scheduled_plan`, `scheduled_plans_for_dashboard`, `scheduled_plans_for_look` |

---

### Tool 3: Agentic LookML (`/lookml/:id?`)
Inspects, branches, authors, validates, tests, and deploys LookML projects using `LkrCodeMode` and the agentic LookML skills (`lookml-field-curation`, `lookml-tests`, `lookml-snapshot`, `lookml-denormalized-view-creator`).

| Action | Project / Model Permission Requirement | Instance-Wide Permissions | SDK Endpoints Invoked |
|---|---|---|---|
| **Read Project Files (Read-Only)** | `see_lookml` or `develop` on **≥1 model** where `model.project_name === project_id` (or `manage_models`) | — | `all_projects`, `project`, `all_project_files`, `project_file`, `get_file_content` |
| **Dev Mode, Git Branch, File CRUD, Validate & LookML Tests** | `develop` on **≥1 model** where `model.project_name === project_id` (or `manage_models`) | — | `update_session({ workspace_id: "dev" })`, `create_git_branch`, `update_git_branch`, `create_file`, `update_file`, `delete_file`, `validate_project`, `run_lookml_test` |
| **Explore Parity & Field Profiling (`pre_gate.py`, `profile_string_fields.py`)** | `develop` on project + `access_data`, `explore` on the specific model being queried | — | `lookml_model_explore`, `run_inline_query`, `create_query` |
| **Raw SQL / Warehouse DDL Introspection (`enrich_partition_clustering.py`)** | `use_sql_runner` on a model using the target connection | — | `all_connections`, `create_sql_query`, `run_sql_query` |
| **Register New LookML Model** | `manage_project_models` (+ `use_global_connections` for global connections) | or `manage_models` | `create_lookml_model`, `update_lookml_model` |
| **Deploy to Production** | `develop` on project | `deploy` | `deploy_to_production` |

---

### Tool 4: 3-Pillar Health Check (`/health-check/:id?`)
Audits Looker System Activity (`system__activity`), LookML project quality (0–4 Transcriber Rubric + `validate_project`), and BigQuery `INFORMATION_SCHEMA` warehouse telemetry. Supports partial execution via `healthScope: 'all' | 'looker' | 'bq'`.

| Pillar / Scope | Required Permissions | Graceful Degradation Behavior | SDK Endpoints Invoked |
|---|---|---|---|
| **Pillar 1: Looker System Activity** (`looker` / `all`) | `see_system_activity` (instance-wide) OR `access_data` + `explore` on `system__activity` model *(Note: blocked for SSO-embedded users)* | If missing, skip `system__activity` explores and report missing `see_system_activity` in pillar status | `run_inline_query` on `system__activity::history`, `dashboard`, `look`, `scheduled_plan`, `pdt_event_log`, `user` |
| **Pillar 2: LookML Code Quality & Rubric** (`looker` / `all`) | `develop` (for `validate_project` + file reads) or `see_lookml` (for file reads only) on ≥1 model per audited project | Audits only projects in `developableProjects` / `readableProjects`; skips `validate_project` if user only has `see_lookml` | `all_projects`, `all_project_files`, `get_file_content`, `validate_project` |
| **Pillar 3: BigQuery `INFORMATION_SCHEMA`** (`bq` / `all`) | `use_sql_runner` on ≥1 model bound to a BigQuery connection (+ GCP `bigquery.jobs.list` on the connection SA) | If missing `use_sql_runner`, disable `'bq'` scope or switch default scope to `'looker'` | `all_connections`, `create_sql_query`, `run_sql_query` |

---

### Tool 5: Python Tile (`/tile/:id?` Studio & `dashboard_tile` Mount)
Executes Monty Python scripts against Looker SDK in `LkrCodeMode` and renders rich SVG/HTML/Markdown tiles on dashboards.

| Context | Required Permissions | Folder / Resource Requirements | SDK Endpoints Invoked |
|---|---|---|---|
| **Studio Authoring (`/tile/:id?`)** | `access_data`, `explore` (on models queried by the script) | Authenticated extension user (`update_artifacts` for saving script artifacts) | `run_inline_query`, `lookml_model_explore`, `search_artifacts`, `update_artifacts` |
| **Publish to Extension Dashboard** | `access_data`, `see_looks`, `see_user_dashboards` + `save_content`, `save_dashboards` | Folder **Edit** access (`folder.can.edit_content`) | `POST/PATCH /dashboards`, `POST/PATCH /dashboard_elements`, `update_artifacts` (`tile_element_${id}`) |
| **Dashboard Tile View Mode (`mountType === 'dashboard_tile'`, not editing)** | `access_data`, `see_user_dashboards` (or `see_lookml_dashboards`) + whatever read permissions the bound Python script calls | Dashboard **View** access | `artifact` / `search_artifacts` (`tile_element_${id}`), plus script's read-only SDK calls |
| **Dashboard Tile Edit Mode (`isDashboardEditing === true`)** | `access_data`, `save_content`, `save_dashboards` | Dashboard **Edit** access (`dashboard.can.update`) | `update_artifacts` (`tile_element_${id}`) |

---

### Shared Infrastructure: `/config` & Per-User Artifact Catalog

| Feature | Required Permissions | Notes |
|---|---|---|
| **Per-User Artifact Catalog (`search_artifacts`, `update_artifacts`, `delete_artifact`)** | Authenticated extension access (`access_data`) | Uses extension artifact namespace; stores per-user index (`user_${uid}_${type}_${id}`) and shared object payload (`obj_${type}_${id}`). |
| **`/config` Save Shared Extension Context (`extensionSDK.saveContextData`)** | `develop` or `admin` | Looker Extension Framework restricts `saveContextData` to admins/developers. Non-permitted users should see `/config` in read-only mode or only see personal OAuth sign-in. |
| **`/config` Hidden Gemini API Key User Attribute (`ensureGeminiApiKeyUserAttribute`)** | `manage_user_attributes` (requires `see_users`) or `admin` | Calls `all_user_attributes`, `create_user_attribute`, `update_user_attribute`. |

---

## 4. Runtime Capability Resolution Pattern

### Step 1: Fetch Roles, Models (with `project_name`), and Folders (with `can`)
In `fetchInitialLookerMetadata(sdk)`:
1. `sdk.me('id,display_name,email,personal_folder_id,home_folder_id,can')`
2. `sdk.all_lookml_models({ fields: 'name,label,project_name,allowed_db_connection_names,can,explores(name,label,description,group_label,hidden)' })`
3. `sdk.all_folders('id,name,parent_id,is_personal,can')`
4. `sdk.user_roles({ user_id: me.id })` wrapped in `try / catch` (because non-admin users without `see_users` may receive a 404 on `/users/{id}/roles` on some Looker configurations).

### Step 2: Compute Effective Capabilities (`UserCapabilities`)
```ts
export interface ToolAvailability {
  enabled: boolean
  readOnly?: boolean
  missingPermissions: string[]
  reason?: string
}

export interface UserCapabilities {
  isAdmin: boolean
  rolesLoaded: boolean
  globalPermissions: Set<string>
  modelsByPermission: Record<string, Set<string>> // '*' means all models
  explorableModels: Set<string>
  developableProjects: Set<string>
  readableProjects: Set<string>
  sqlRunnerConnections: Set<string>
  editableFolderIds: Set<string>
  canConfigureExtension: boolean
  canManageUserAttributes: boolean
  tools: Record<'app' | 'dashboard' | 'lookml' | 'health' | 'tile', ToolAvailability>
}
```

### Step 3: Fallback When `user_roles` Is Restricted
If `sdk.user_roles({ user_id: me.id })` throws a 404/403:
- Infer **explorable models** from `all_lookml_models` (Looker already filters `all_lookml_models` to models the user has `access_data` / `explore` / `see_lookml` / `develop` on).
- Infer **developable/readable projects** from models that have non-empty `project_name` and `model.can?.develop` (or probe `sdk.session()` to check if `can.update` / dev workspace switching is permitted).
- Infer **editable folders** from `folder.can?.edit_content !== false && folder.can?.save_content !== false` (plus `me.personal_folder_id`).
- Default tool availability to optimistic (`enabled: true`) and rely on **Role-Denied 404 classification** at call time to surface exact missing permissions.
