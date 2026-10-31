# LookML Reviewer Skill

An automated code review agent skill for LookML projects powered by `looker-cli`. It audits entire projects or targeted LookML files against official Looker best practices, LAMS style standards, and Conversational Analytics (Gemini in Looker) readiness.

Built to comply with the **Open Knowledge Format (OKF v0.1)**.

---

## ⚡ Prerequisites

To use this skill, `looker-cli` must be installed and authenticated to your Looker instance:

1. **Installation**: `looker-cli` must be available in your system `PATH`.
   - Follow: [Installing Looker CLI](https://github.com/looker-open-source/looker-skills/tree/main/skills/installing-looker-cli)
2. **Authentication**: Authenticate using OAuth PKCE (recommended) or API credentials.
   - Follow: [Authenticating Looker CLI](https://github.com/looker-open-source/looker-skills/tree/main/skills/authenticating-looker-cli)
3. **CLI Reference**:
   - Reference: [Using Looker CLI](https://github.com/looker-open-source/looker-skills/tree/main/skills/using-looker-cli)

---

## 🚀 How to Use

Invoke the skill by asking the agent to review your LookML code. You can review an entire project or a specific file on any branch.

### Required Inputs
- **Looker Instance URL** (e.g., `https://mycompany.looker.com` or Looker Core URL)
- **Project Name** (e.g., `fashionly`)
- **Branch Name** (e.g., `master` or `main`)
- *(Optional)* **Target File** (e.g., `views/order_items.view.lkml`)

### Example Prompts
```text
"Review the LookML in project 'fashionly' on branch 'master'."
"Audit the view 'views/order_items.view.lkml' in the 'fashionly' project on branch 'dev-branch'."
```

---

## 🧩 Custom Guidelines (Pluggable Knowledge)

You can easily customize or extend the review rules to match your organization's internal standards:
- Add your own `.md` guidelines into the [`references/`](./references/) directory.
- The agent automatically incorporates any documents in `references/` into its audit without requiring custom code or regex rules.

---

## 📂 Bundle Structure

```text
skills/lookml_reviewer/
├── README.md           # This file
├── index.md            # OKF v0.1 root knowledge index
├── SKILL.md            # Main OKF howto review procedure
└── references/         # Pluggable best practice guides
    ├── lookml-dos-and-donts.md
    ├── lams-style-guide.md
    ├── sustainable-maintainable-lookml.md
    └── conversational-analytics-best-practices.md
```
