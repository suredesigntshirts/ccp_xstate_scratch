---
name: install
description: Install the ccp-harness in this project, so every new session journals a fingerprint and a self-check. Use only when the person, or a plan item they delegated, asks to install the harness here.
---

# Install ccp-harness in this project

The plugin is on every session the environment builds, but it does nothing in a project until it is installed
there. Installing writes two things into the project's shared files, and nothing else:

- the journal root, `/mnt/project-files/harness/journal/sessions/`, where each session appends its own file;
- the install marker, `/mnt/project-files/harness/install.json`, naming the release and the session that installed.

Run the install script from this plugin. Its path is two folders up from this skill's base directory:

```
node "<this skill's base directory>/../../scripts/install.mjs"
```

Then tell the person the one line it printed. The hooks start working from the next session, not this one
(plugins load at session start). Running it again changes nothing.

To turn the harness off in a session without uninstalling, set `CCP_HARNESS_DISABLED=1`. To uninstall, delete
`install.json`; the journal stays.
