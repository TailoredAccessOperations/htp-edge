(() => {
  "use strict";

  const workflow = [
    { stage: "01", label: "Discover", agents: ["explore", "researcher", "browser-use"], output: "Repository facts, page inventory, and source evidence" },
    { stage: "02", label: "Plan", agents: ["plan", "planner", "general-purpose"], output: "Implementation strategy and task graph" },
    { stage: "03", label: "Build", agents: ["coder", "grok-build", "cursor"], output: "Reviewed code and working page changes" },
    { stage: "04", label: "Route", agents: ["router"], output: "Traceable ocmesh messages between workstreams" },
    { stage: "05", label: "Verify", agents: ["debugger", "devops"], output: "Tests, logs, containers, and deployment checks" },
    { stage: "06", label: "Review", agents: ["reviewer"], output: "Diff review and merge decision" },
  ];

  const canonicalAgents = (window.HTP_AGENT_CATALOG || [
    ["builtin", "browser-use", "Web browsing and interaction agent"],
    ["builtin", "cursor", "Alternate toolset and prompt profile"],
    ["builtin", "explore", "Fast, read-only agent specialized for codebase exploration"],
    ["builtin", "general-purpose", "General purpose agent for multi-step tasks"],
    ["builtin", "grok-build", "Grok Build agent for software engineering tasks"],
    ["builtin", "plan", "Software architect for planning implementation strategies"],
    ["core", "coder", "Writes and edits code"],
    ["core", "planner", "Breaks a task into subtasks for other agents"],
    ["core", "reviewer", "Reviews work and merges mesh results"],
    ["mesh", "router", "Documents the ocmesh message protocol"],
    ["ops", "debugger", "Root-causes errors from logs and traces"],
    ["ops", "devops", "Shell, CI, deploys, services"],
    ["research", "researcher", "Gathers and summarizes information"],
  ]).map(([group, name, role]) => ({ group, name, role, id: name, action: role, mode: group }));

  /* Canonical catalog fallback ends here. */
  const legacyAgents = [
    { id: "browser-use", group: "builtin", name: "browser-use", role: "Web browsing and interaction agent", action: "Browse and interact with pages", mode: "browser" },
    { id: "cursor", group: "builtin", name: "cursor", role: "Alternate toolset and prompt profile", action: "Switch toolsets and prompt profiles", mode: "profile" },
    { id: "explore", group: "builtin", name: "explore", role: "Fast, read-only agent specialized for codebase exploration", action: "Inspect repositories without changing files", mode: "readonly" },
    { id: "general-purpose", group: "builtin", name: "general-purpose", role: "General purpose agent for multi-step tasks", action: "Coordinate multi-step implementation work", mode: "general" },
    { id: "grok-build", group: "builtin", name: "grok-build", role: "Grok Build agent for software engineering tasks", action: "Build and iterate on software tasks", mode: "build" },
    { id: "plan", group: "builtin", name: "plan", role: "Software architect for planning implementation strategies", action: "Design implementation strategies", mode: "plan" },
    { id: "coder", group: "core", name: "coder", role: "Writes and edits code", action: "Write and edit application code", mode: "write" },
    { id: "planner", group: "core", name: "planner", role: "Breaks a task into subtasks for other agents", action: "Decompose work into agent tasks", mode: "delegate" },
    { id: "reviewer", group: "core", name: "reviewer", role: "Reviews work and merges mesh results", action: "Review diffs and merge mesh results", mode: "review" },
    { id: "router", group: "mesh", name: "router", role: "Documents the ocmesh message protocol", action: "Route and document mesh messages", mode: "protocol" },
    { id: "debugger", group: "ops", name: "debugger", role: "Root-causes errors from logs and traces", action: "Trace failures to their root cause", mode: "diagnose" },
    { id: "devops", group: "ops", name: "devops", role: "Shell, CI, deploys, services", action: "Operate shells, CI, deploys, and services", mode: "operate" },
    { id: "researcher", group: "research", name: "researcher", role: "Gathers and summarizes information", action: "Gather and summarize project information", mode: "research" },
  ];

  const agents = canonicalAgents.length ? canonicalAgents : legacyAgents;

  const root = document.getElementById("agent-board");
  if (!root) return;
  const grid = root.querySelector("[data-agent-grid]");
  const filter = root.querySelector("[data-agent-filter]");
  const group = root.querySelector("[data-agent-group]");
  const count = root.querySelector("[data-agent-count]");
  const detail = root.querySelector("[data-agent-detail]");
  const form = root.querySelector("[data-agent-form]");
  const prompt = root.querySelector("[data-agent-prompt]");
  const output = root.querySelector("[data-agent-output]");
  const workflowRoot = root.querySelector("[data-agent-workflow]");

  const esc = (value) => String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));

  function renderWorkflow() {
    if (!workflowRoot) return;
    workflowRoot.innerHTML = workflow.map((step) => `<article class="agent-workflow__step"><span class="agent-workflow__stage">${esc(step.stage)}</span><h3>${esc(step.label)}</h3><p>${step.agents.map((id) => `<button type="button" class="agent-workflow__agent" data-workflow-agent="${esc(id)}">${esc(id)}</button>`).join(" ")}</p><p class="agent-workflow__output">${esc(step.output)}</p></article>`).join("");
    workflowRoot.querySelectorAll("[data-workflow-agent]").forEach((button) => button.addEventListener("click", () => select(button.dataset.workflowAgent)));
  }

  function render() {
    const query = (filter.value || "").trim().toLowerCase();
    const selectedGroup = group.value;
    const visible = agents.filter((agent) => {
      const matchesGroup = selectedGroup === "all" || agent.group === selectedGroup;
      const haystack = `${agent.name} ${agent.role} ${agent.action} ${agent.mode}`.toLowerCase();
      return matchesGroup && (!query || haystack.includes(query));
    });
    count.textContent = `${visible.length}/${agents.length} agents`;
    grid.innerHTML = visible.map((agent) => `
      <button class="agent-card" type="button" data-agent-id="${esc(agent.id)}" aria-pressed="false">
        <span class="agent-card__top"><span class="agent-card__name">${esc(agent.name)}</span><span class="agent-card__group">${esc(agent.group)}</span></span>
        <span class="agent-card__role">${esc(agent.role)}</span>
        <span class="agent-card__action">${esc(agent.action)}</span>
      </button>`).join("");
    grid.querySelectorAll("[data-agent-id]").forEach((button) => button.addEventListener("click", () => select(button.dataset.agentId)));
    if (!visible.length) detail.textContent = "No agent matches this filter.";
  }

  function select(id) {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return;
    grid.querySelectorAll("[data-agent-id]").forEach((button) => {
      const active = button.dataset.agentId === id;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    detail.innerHTML = `<strong>${esc(agent.name)}</strong> · ${esc(agent.group)} · mode=${esc(agent.mode)}<br>${esc(agent.role)}<br><span class="dim">${esc(agent.action)}</span>`;
    prompt.value = `${agent.name}: `;
    prompt.focus();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text) return;
    output.textContent = `[agent-board] queued: ${text}`;
    prompt.value = "";
  });
  filter.addEventListener("input", render);
  group.addEventListener("change", render);
  renderWorkflow();
  render();
  select("planner");
})();
