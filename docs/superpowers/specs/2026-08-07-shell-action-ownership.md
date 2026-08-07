# Desktop Shell Action Ownership

## Change Evidence Card

- Reported symptom: Profile object actions remain in the page header; Workspace selection and refresh are separated from the selected folder; resource child panels use a confusing connector line; shared controls render at different sizes.
- Governing contract and user intent: AgentEnv Manager is a local desktop workspace for selecting one object, editing its intent, reviewing its effect, and applying it safely. Commands must sit beside the object they mutate.
- Defect class and owning layer: shell/action ownership and shared visual primitives, owned by `PageHeader`, `InspectorHeader`, `ControlGroup`, `ObjectSwitcher`, `ResourceDisclosureSection`, and their shared styles.
- Sibling surfaces, states, locales, and viewports: Profiles, Workspaces, Agents, Conversations, Skills, and Settings; idle, dirty, working, disabled, expanded, long-content, Chinese/English, minimum/default/large supported windows.
- Required proof and artifact identity: renderer contract tests, Electron geometry tests, paired screenshots from the rebuilt artifact, overflow and diff checks. Renderer/CSS changes invalidate all previous desktop evidence.

## Product Rules

1. Page headers own page actions only: create, import, add, global refresh, and page menus.
2. Inspector headers own selected-object actions: save, compare, evaluate, apply, open, and current-object refresh.
3. Resource sections own disclosure and resource-local actions. Child panels use inset surface hierarchy, not decorative connector lines.
4. Repeated controls use the shared component and named variants; page CSS may position them but may not redefine their control grammar.
5. Every async action exposes idle, working, success/no-op, warning, error, and cancellation behavior at the initiating control.
