// Folder-name workspace sidebar: same list/group/drag behavior as cmux's
// bundled Workspaces template, but each row's title comes from the workspace
// folder basename (w.directory) instead of the terminal/agent title.
//
// Created from cmux's bundled workspaces.js. Behavior changes from the
// template: displayTitle() uses the folder name, a compact agent-status dot,
// no per-row rename (the title is derived), and each workspace's tabs nested
// beneath it (all expanded by default; the chevron collapses a workspace).
//
// Select it:  cmux sidebar select folder-titles
// Edit it:    ~/.config/cmux/sidebars/folder-titles.js (hot reloads on save)
// Revert:     right-click the sidebar toggle and pick the built-in sidebar,
//             or delete this file.
//
// Dia-style workspace sidebar: groups, cross-group drag, full context menus.
//
// The whole sidebar is ONE flat drag surface: group headers and workspace
// rows live in a single Reorderable. Headers are `fixed` (not grabbable, but
// they shift to open gaps like any row), so a workspace can be dragged
// between groups, into a group, or out to the ungrouped area in one gesture.
// The drop resolves to (container group, reorder anchor) from the flat index
// and dispatches workspace.group.add/remove + workspace.reorder.
//
// Group collapse is optimistic (a local signal flips instantly) and syncs via
// workspace.group.collapse/expand so the built-in sidebar agrees.
//
// Install:  cp Examples/CustomSidebars/workspaces.js ~/.config/cmux/sidebars/
// Open:     cmux sidebar open workspaces

// --- optimistic UI -------------------------------------------------------------
// Every user action flips local state the same frame; the cmux command runs
// behind it and the authoritative data context (which refreshes about once a
// second) reconciles: each override clears itself as soon as the data agrees.
let selectOverride = null;
const [selectTick, setSelectTick] = signal(0);

function isSelected(w) {
  selectTick();
  if (!w) return false;
  if (selectOverride) {
    if (data.selectedId() === selectOverride) selectOverride = null; // caught up
    else return w.id === selectOverride;
  }
  return !!w.selected;
}

function selectWorkspace(id) {
  if (!id) return;
  selectOverride = id;
  setSelectTick(selectTick() + 1);
  cmux("workspace.select", { workspace_id: id });
}

const closedOverride = new Set();
const [closeTick, setCloseTick] = signal(0);

// Optimistic tabs order: a bulk drop rearranges rows locally the same frame
// (reorder_many echoes ~1s later); clears itself once the data agrees.
let orderOverride = null;
const [orderTick, setOrderTick] = signal(0);

function setOrderOverride(ids) {
  orderOverride = ids;
  setOrderTick(orderTick() + 1);
}

function visibleWorkspaces() {
  closeTick();
  orderTick();
  let ws = data.workspaces() ?? [];
  for (const id of Array.from(closedOverride)) {
    if (!ws.some((w) => w.id === id)) closedOverride.delete(id); // caught up
  }
  ws = ws.filter((w) => !closedOverride.has(w.id));
  if (orderOverride) {
    const actual = ws.map((w) => w.id).join(",");
    const wanted = orderOverride.filter((id) => ws.some((w) => w.id === id)).join(",");
    if (actual === wanted) {
      orderOverride = null; // caught up
    } else {
      const rank = new Map(orderOverride.map((id, i) => [id, i]));
      ws = [...ws].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    }
  }
  return ws;
}

function closeWorkspace(id) {
  closedOverride.add(id);
  setCloseTick(closeTick() + 1);
  cmux("workspace.close", { workspace_id: id });
}

// Multi-select: Cmd-click toggles, Shift-click extends from the last click
// over the visible row order, plain click clears. The selection drives the
// context menu's bulk actions (group together, move, close).
const multiSelected = new Set();
const [multiTick, setMultiTick] = signal(0);
let lastClickedId = null;

function isMultiSelected(w) {
  multiTick();
  return !!w && multiSelected.has(w.id);
}

function clearMultiSelect() {
  if (multiSelected.size === 0) return;
  multiSelected.clear();
  setMultiTick(multiTick() + 1);
}

function visibleRowIds() {
  return flatEntries().filter((e) => e.kind === "ws").map((e) => e.wsId);
}

function handleRowClick(w, payload) {
  const id = w.id;
  if (payload && payload.cmd) {
    if (multiSelected.has(id)) multiSelected.delete(id);
    else multiSelected.add(id);
    setMultiTick(multiTick() + 1);
  } else if (payload && payload.shift && lastClickedId) {
    const order = visibleRowIds();
    const a = order.indexOf(lastClickedId);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      for (const rid of order.slice(Math.min(a, b), Math.max(a, b) + 1)) multiSelected.add(rid);
      setMultiTick(multiTick() + 1);
    }
  } else {
    clearMultiSelect();
    selectWorkspace(id);
  }
  lastClickedId = id;
}

// The set of workspaces a bulk menu action applies to: the multi-selection
// when the clicked row is part of it, else just the clicked row.
function bulkIds(w) {
  multiTick();
  if (w && multiSelected.has(w.id)) return Array.from(multiSelected);
  return w ? [w.id] : [];
}

const titleOverride = new Map();
const [titleTick, setTitleTick] = signal(0);

// Titles show the workspace's folder name instead of the terminal/agent title.
function folderName(w) {
  if (!w) return "";
  const dir = typeof w.directory === "string" ? w.directory.replace(/\/+$/, "") : "";
  const base = dir.split("/").filter(Boolean).pop();
  return base || w.title || "";
}

function displayTitle(w) {
  titleTick();
  if (!w) return "";
  if (titleOverride.has(w.id)) {
    const t = titleOverride.get(w.id);
    if (w.title === t) titleOverride.delete(w.id); // caught up
    else return t;
  }
  return folderName(w);
}

// --- inline rename -----------------------------------------------------------
// Double-click a row/header (or its Rename menu item) to edit in place.
// Editing swaps the entry's key, so the keyed reconciler remounts the row as
// an editor; Return commits through workspace(.group).rename, Escape cancels.
const [editingId, setEditingId] = signal(null);

// --- optimistic collapse -----------------------------------------------------
const collapseOverride = new Map();
const [collapseTick, setCollapseTick] = signal(0);

function isCollapsed(g) {
  collapseTick();
  if (collapseOverride.has(g.id)) {
    const v = collapseOverride.get(g.id);
    if (v === g.collapsed) collapseOverride.delete(g.id); // host caught up
    else return v;
  }
  return g.collapsed;
}

function toggleCollapse(g) {
  const next = !isCollapsed(g);
  collapseOverride.set(g.id, next);
  setCollapseTick(collapseTick() + 1);
  cmux(next ? "workspace.group.collapse" : "workspace.group.expand", { group_id: g.id });
}

// --- data helpers ------------------------------------------------------------
const groupById = (id) => (data.groups() ?? []).find((g) => g.id === id);
const membersOf = (id) => visibleWorkspaces().filter((w) => w.group === id);
// The anchor workspace IS the header (matching the built-in sidebar).
const memberRowsOf = (id) => {
  const g = groupById(id);
  return membersOf(id).filter((w) => !g || w.id !== g.anchorId);
};

// One flat entry list. A group renders (header + expanded member rows) at
// its ANCHOR's tabs position - the app's canonical block position - so a
// stray member sitting early in the tabs order can never yank the whole
// group upward. Pinned groups and pinned ungrouped workspaces float to a
// cluster at the top.
const flatEntries = computed(() => {
  const ws = visibleWorkspaces();
  const groups = new Map((data.groups() ?? []).map((g) => [g.id, g]));
  const editing = editingId();
  const wsEntry = (w, groupId) => ({
    kind: "ws",
    id: w.id + (editing === w.id ? ":edit" : ""),
    wsId: w.id,
    editing: editing === w.id,
    groupId,
  });
  const groupSection = (g) => {
    const out = [{
      kind: "header",
      id: "h:" + g.id + (editing === "h:" + g.id ? ":edit" : ""),
      groupId: g.id,
      editing: editing === "h:" + g.id,
    }];
    if (!isCollapsed(g)) {
      for (const m of memberRowsOf(g.id)) out.push(wsEntry(m, g.id));
    }
    return out;
  };

  const pinned = [];
  const rest = [];
  const seen = new Set();
  for (const w of ws) {
    if (w.group && groups.has(w.group)) {
      const g = groups.get(w.group);
      // Emit the group at its anchor's position; a group whose anchor is
      // hidden (optimistically closed) falls back to its first member.
      const isAnchor = w.id === g.anchorId || !ws.some((x) => x.id === g.anchorId);
      if (seen.has(g.id) || !isAnchor) continue;
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...groupSection(g));
    } else if (!w.group) {
      (w.pinned ? pinned : rest).push(wsEntry(w, null));
    }
  }
  // Groups whose anchor never appeared (edge churn): append at the end.
  for (const g of groups.values()) {
    if (!seen.has(g.id) && ws.some((x) => x.group === g.id)) {
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...groupSection(g));
    }
  }
  return [...pinned, ...rest];
});

// --- drop resolution ---------------------------------------------------------
// `index` is the dragged row's slot in the flat list (headers included).
// `extra.side` resolves the ambiguous boundary slots: "above" nests with the
// row above (e.g. last item of a group), "below" with the row below (right
// after the group, outside it) - chosen by the pointer's X position mid-drag.
// Dragging a group HEADER moves the whole block (extra.block).
function handleMove(id, index, extra) {
  // Use the order currently rendered, including optimistic reorder overrides.
  // The host-provided `index` fields can lag behind that view for one or more
  // frames after a bulk or group move.
  const ws = visibleWorkspaces();

  if (extra && extra.block && id.startsWith("h:")) {
    // Whole-group move. workspace.group.move is NOT usable here: its
    // to_index is a group-slot index (position among groups, clamped to the
    // pin tier), so a tabs index overshoots to "last group" and a drop
    // between ungrouped rows is unreachable. Instead send the full tabs
    // order with the block extracted and re-inserted contiguously (anchor
    // first) at the drop slot - the app's contiguity normalization keeps it.
    const gid = id.slice(2);
    const memberIds = new Set(membersOf(gid).map((w) => w.id));
    const entries = flatEntries().filter((e) => e.id !== id && e.groupId !== gid);
    // The next entry that stays put anchors the drop. A header counts too:
    // dropping right above a (possibly collapsed) group means "before its
    // anchor", not "after its hidden members".
    const nextEntry = entries.slice(index).find((e) => e.kind === "ws" || e.kind === "header");
    const nextId = nextEntry
      ? (nextEntry.kind === "header" ? groupById(nextEntry.groupId)?.anchorId : nextEntry.wsId)
      : null;
    const anchorId = groupById(gid)?.anchorId;
    const blockIds = ws.map((x) => x.id).filter((x) => memberIds.has(x));
    if (anchorId && blockIds.includes(anchorId)) {
      blockIds.splice(blockIds.indexOf(anchorId), 1);
      blockIds.unshift(anchorId);
    }
    const rest = ws.map((x) => x.id).filter((x) => !memberIds.has(x));
    let insertAt = nextId ? rest.indexOf(nextId) : rest.length;
    if (insertAt < 0) insertAt = rest.length;
    const full = [...rest.slice(0, insertAt), ...blockIds, ...rest.slice(insertAt)];
    setOrderOverride(full); // paint the new order now; reorder_many echoes behind it
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(full) });
    return;
  }

  const dragged = ws.find((w) => w.id === id);
  if (!dragged) return;

  // Dragging a row that is part of the multi-selection moves the WHOLE
  // selection: the visible selected rows gather contiguously at the drop
  // slot (visual order preserved) and all take the slot's container. This is
  // the platform-standard resolution for non-contiguous selections and for
  // selections mixing in-group and ungrouped rows. Hidden rows (inside a
  // collapsed group) never move - what you see is what you drag.
  multiTick();
  const bulk = multiSelected.has(id) && multiSelected.size > 1;
  const movingIds = bulk
    ? visibleRowIds().filter((rid) => multiSelected.has(rid) || rid === id)
    : [id];
  const moving = new Set(movingIds);

  const entries = flatEntries().filter((e) => e.id !== id);
  // Neighbors that will NOT move: rows moving with the drag can't define the
  // drop's container or anchor.
  let prev = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.kind === "ws" && moving.has(e.wsId ?? e.id)) continue;
    prev = e;
    break;
  }
  const stays = (e) => !(e.kind === "ws" && moving.has(e.wsId ?? e.id));
  // The drop's tabs-order anchor is the next entry that stays put. A header
  // resolves to its group's ANCHOR workspace: dropping above a group means
  // "before the whole block", never "between its anchor and members" (which
  // would break contiguity and get normalized somewhere else).
  const nextEntry = entries.slice(index).find((e) => {
    if (e.kind === "header") return !moving.has(groupById(e.groupId)?.anchorId);
    return e.kind === "ws" && stays(e);
  });
  const nextAny = entries.slice(index).find(stays) ?? null;
  const nextRefId = nextEntry
    ? (nextEntry.kind === "header" ? groupById(nextEntry.groupId)?.anchorId : (nextEntry.wsId ?? nextEntry.id))
    : null;
  const nextWorkspace = nextRefId ? ws.find((w) => w.id === nextRefId) : null;

  let container;
  if (extra && extra.side === "below") {
    // Nest with what's below: a header below means "above the next group",
    // i.e. ungrouped; a row below means its group (or ungrouped).
    container = nextAny && nextAny.kind === "ws" ? nextAny.groupId : null;
  } else {
    container = prev ? prev.groupId : null;
    // Dropping right below a collapsed group's header means "after the whole
    // group", not "into it" (its rows are hidden), unless it lives there.
    if (prev && prev.kind === "header") {
      const g = groupById(prev.groupId);
      if (g && isCollapsed(g) && dragged.group !== g.id) container = null;
    }
  }

  for (const rid of movingIds) {
    const row = ws.find((w) => w.id === rid);
    if (!row) continue;
    if ((row.group ?? null) !== container) {
      if (container) {
        cmux("workspace.group.add", { group_id: container, workspace_id: rid });
      } else {
        cmux("workspace.group.remove", { workspace_id: rid });
      }
    }
  }

  if (bulk) {
    // Atomic block placement: send the full tabs order with the moving rows
    // inserted contiguously before the anchor.
    const rest = ws.map((x) => x.id).filter((x) => !moving.has(x));
    let insertAt = nextWorkspace ? rest.indexOf(nextWorkspace.id) : rest.length;
    if (insertAt < 0) insertAt = rest.length;
    const full = [...rest.slice(0, insertAt), ...movingIds, ...rest.slice(insertAt)];
    setOrderOverride(full); // gather instantly; reorder_many echoes behind it
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(full) });
    clearMultiSelect();
    return;
  }

  if (nextWorkspace) {
    const draggedPosition = ws.findIndex((w) => w.id === dragged.id);
    const before = ws.findIndex((w) => w.id === nextWorkspace.id);
    const target = draggedPosition < before ? before - 1 : before;
    cmux("workspace.reorder", { workspace_id: id, index: target });
  } else {
    cmux("workspace.reorder", { workspace_id: id, index: ws.length - 1 });
  }
  // Dragging an unselected row with a selection active clears the stale
  // selection (platform convention).
  clearMultiSelect();
}

// --- nested tabs ---------------------------------------------------------------
// Tabs live under their workspace row. Every workspace is expanded by default;
// the chevron overrides that per workspace and the override sticks until the
// file reloads.
const expandOverride = new Map();
const [expandTick, setExpandTick] = signal(0);

function isExpanded(w) {
  expandTick();
  if (!w) return false;
  if (expandOverride.has(w.id)) return expandOverride.get(w.id);
  return true;
}

function toggleExpanded(w) {
  if (!w) return;
  expandOverride.set(w.id, !isExpanded(w));
  setExpandTick(expandTick() + 1);
}

function tabCount(w) {
  return (w && w.tabs ? w.tabs.length : 0);
}

function visibleTabs(w) {
  const ws = w();
  if (!ws) return [];
  return isExpanded(ws) ? (ws.tabs ?? []) : [];
}

// Tab titles often end with " - <folder>", which the parent row already shows.
function tabTitle(w, t) {
  let title = (t && t.title) || "Untitled";
  for (const name of [folderName(w), w && w.title]) {
    if (name && title.length > name.length + 3 && title.endsWith(" - " + name)) {
      title = title.slice(0, -(name.length + 3));
    }
  }
  return title;
}

// The agent running in a tab, shown as an SF Symbol. Custom sidebars can only
// render SF Symbols (not cmux's AgentIcons/* brand assets), so this uses the
// symbol + color cmux itself pairs with each agent in its text-box actions.
const AGENT_ICONS = {
  claude: ["sparkle", "#F6D5C8"],
  codex: ["sparkles", "#8FDBFF"],
  opencode: ["curlybraces", "#B5E48C"],
  pi: ["brain.head.profile", "#D0B3FF"],
};

function tabAgent(w, t) {
  return ((w && w.agents) || []).find(
    (a) => t && a.panelId === t.id && a.status !== "ended");
}

function tabAgentIcon(w, t) {
  const agent = tabAgent(w, t);
  if (!agent) return ["", "clear"];
  return AGENT_ICONS[String(agent.kind).toLowerCase()] ?? ["terminal", "tertiary"];
}

// Activity cue: a working agent's icon breathes (its opacity alternates on the
// ~1s clock tick) and the row shows how long it has been running.
function tabAgentOpacity(w, t) {
  const agent = tabAgent(w, t);
  if (!agent || agent.status !== "working") return 1;
  return (data.clock()?.second ?? 0) % 2 ? 0.3 : 1;
}

function tabElapsed(w, t) {
  const agent = tabAgent(w, t);
  const now = data.clock()?.epoch;
  const since = agent && (agent.sinceEpoch ?? agent.lastActivityAt);
  if (!agent || agent.status !== "working" || !now || !since) return "";
  const s = Math.max(0, Math.floor(now - since));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h" + (m % 60 ? (m % 60) + "m" : "");
}

// A tree guide (thin rail under the parent's chevron) replaces the
// per-tab dots, so tabs never read as workspaces; the focused tab's rail is
// accent-colored.
function tabRow(w, t) {
  const isFocused = () => !!t().focused && !!(w() && w().selected);
  return HStack({ spacing: 10 }, [
    Rectangle()
      .fill(() => (isFocused() ? "accent" : "#7f7f7f40"))
      .frame(() => ({ width: isFocused() ? 2 : 1, height: 26 })),
    Image(() => tabAgentIcon(w(), t())[0])
      .font(12)
      .color(() => tabAgentIcon(w(), t())[1])
      .opacity(() => tabAgentOpacity(w(), t()))
      .rotation(() => (tabAgentOpacity(w(), t()) < 1 ? 45 : 0))
      .frame({ width: 14, height: 14 }),
    Text(() => tabTitle(w(), t()))
      .font(13)
      .lineLimit(1)
      .truncation("tail")
      .color(() => (isFocused() ? "primary" : "secondary")),
    Spacer({ minLength: 0 }),
    Text(() => tabElapsed(w(), t()))
      .font(11).monospaced().color("tertiary")
      .fixedSize()
      .layoutPriority(2),
    // Orange: the tab's agent is waiting on input (wins over unread); blue: unread.
    Circle({ size: 6 }).fill(() =>
      (tabAgent(w(), t())?.status === "needs_input" ? "#E8A33D"
        : (t().hasUnread ? "#4C8DFF" : "clear"))),
  ])
    .paddingLeading(15)
    .paddingTrailing(10)
    .cornerRadius(7)
    .frame({ maxWidth: "infinity" })
    .hoverBackground("#7f7f7f1f")
    .onTap(() => {
      cmux("workspace.select", { workspace_id: w().id });
      if (t().surfaceId) cmux("surface.focus", { surface_id: t().surfaceId });
    });
}

function workspaceItem(w, entry) {
  return VStack({ spacing: 0 }, [
    workspaceRow(w, entry),
    ForEach(
      { items: () => visibleTabs(w), key: (t) => t.id },
      (t) => tabRow(w, t)
    ),
  ]);
}

// --- rows ----------------------------------------------------------------------
function workspaceMenu(w) {
  const act = (action) => () =>
    cmux("workspace.action", { action, workspace_id: w().id });
  const groupItems = (data.groups() ?? []).map((g) =>
    Button(() => (groupById(g.id)?.name ?? ""), () => {
      for (const id of bulkIds(w())) cmux("workspace.group.add", { group_id: g.id, workspace_id: id });
      clearMultiSelect();
    }));
  const count = () => bulkIds(w()).length;
  return [
    Button(() => (count() > 1 ? "New Group from " + count() + " Workspaces" : "New Group with This"), () => {
      cmux("workspace.group.create", {
        name: "New Group",
        child_workspace_ids: JSON.stringify(bulkIds(w())),
      });
      clearMultiSelect();
    }),
    Divider(),
    Button(() => (w()?.pinned ? "Unpin" : "Pin"), () =>
      cmux("workspace.action", { action: w()?.pinned ? "unpin" : "pin", workspace_id: w().id })),
    Button(() => (w()?.unread > 0 ? "Mark as Read" : "Mark as Unread"), () =>
      cmux("workspace.action", { action: w()?.unread > 0 ? "mark_read" : "mark_unread", workspace_id: w().id })),
    Divider(),
    Menu("Move", [
      Button("Move Up", act("move_up")),
      Button("Move Down", act("move_down")),
      Button("Move to Top", act("move_top")),
    ]),
    Menu("Move to Group", groupItems),
    Button("Remove from Group", () => cmux("workspace.group.remove", { workspace_id: w().id })),
    Divider(),
    Button("Close Others", act("close_others")).destructive(),
    Button(() => (count() > 1 ? "Close " + count() + " Workspaces" : "Close"), () => {
      for (const id of bulkIds(w())) closeWorkspace(id);
      clearMultiSelect();
    }).destructive(),
  ];
}

function workspaceRow(w, entry) {
  // The title owns the FULL row width; badge, pin, and close button FLOAT
  // over its trailing edge (ZStack trailing) instead of reserving layout.
  // No fades anywhere (they read as glitches when they appear); overflow
  // truncates with a plain ellipsis, and a title too long to fit starts
  // marqueeing after the hover holds 0.5s.
  return ZStack({ alignment: "trailing" }, [
    HStack({ spacing: 6 }, [
      Image("chevron.right")
        .font(10).weight("semibold").color("tertiary")
        .rotation(() => (isExpanded(w()) ? 90 : 0))
        .frame({ width: 12, height: 16 })
        .opacity(() => (tabCount(w()) > 0 ? 1 : 0))
        .onTap(() => toggleExpanded(w())),
      Text(() => displayTitle(w()))
        .font(14)
        .weight(() => (isSelected(w()) ? "semibold" : "regular"))
        .lineLimit(1)
        .truncation("tail")
        .marquee()
        .color(() => (isSelected(w()) ? "primary" : "secondary")),
      Text(() => (tabCount(w()) > 0 && !isExpanded(w()) ? String(tabCount(w())) : ""))
        .font(11).monospaced().color("tertiary"),
      Spacer({ minLength: 0 }),
    ])
      .frame({ maxWidth: "infinity" }),
    ZStack({}, [
      // Pin marker at rest; on hover it yields to the close button.
      Image("pin.fill")
        .font(9).color("tertiary")
        .opacity(() => (w()?.pinned ? 1 : 0))
        .hideOnHover(),
      // Circular close: uniform padding around the glyph + full-round corner
      // (the background hugs content+padding, so padding IS the circle size).
      // The circle only paints while the X ITSELF is hovered (hoverBackground
      // with no resting background tracks the node's own pointer).
      Image("xmark")
        .font(10).weight("semibold").color("secondary")
        .padding(4)
        .cornerRadius(10)
        .hoverBackground("#7f7f7f4a")
        .showOnHover()
        .onTap(() => closeWorkspace(w().id)),
    ]),
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .marginLeading(() => (entry().groupId ? 14 : 0))
    .cornerRadius(9)
    .background(() => (isMultiSelected(w()) ? "#4C9EEB33" : (isSelected(w()) ? "#7f7f7f3d" : null)))
    .hoverBackground(() => (isMultiSelected(w()) ? "#4C9EEB33" : (isSelected(w()) ? "#7f7f7f3d" : "#7f7f7f24")))
    .frame({ maxWidth: "infinity" })
    .block(() => (entry().groupId ? "h:" + entry().groupId : null))
    .dragSet(() => (isMultiSelected(w()) ? "multi" : null))
    .onTap((payload) => handleRowClick(w(), payload))
    .contextMenu(workspaceMenu(w));
}

// In-place editor row (same box as a workspace row).
function workspaceEditRow(w, entry) {
  return HStack({ spacing: 8 }, [
    TextField(() => w()?.title ?? "", {
      placeholder: "Workspace name",
      onSubmit: (t) => {
        const title = (t ?? "").trim();
        if (title) {
          titleOverride.set(w().id, title);
          setTitleTick(titleTick() + 1);
          cmux("workspace.action", { action: "rename", workspace_id: w().id, title });
        } else {
          cmux("workspace.action", { action: "clear_name", workspace_id: w().id });
        }
        setEditingId(null);
      },
      onCancel: () => setEditingId(null),
    }).font(14),
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .cornerRadius(9)
    .background("#7f7f7f3d")
    .marginLeading(() => (entry().groupId ? 14 : 0))
    .frame({ maxWidth: "infinity" });
}

function groupHeader(groupId) {
  const g = () => groupById(groupId) ?? { id: groupId, name: "", collapsed: false, pinned: false };
  const anchor = () => (data.workspaces() ?? []).find((w) => w.id === g().anchorId);
  const groupAct = (action) => () =>
    cmux("workspace.group.action", { group_id: groupId, action });
  return HStack({ spacing: 6 }, [
    // The chevron toggles collapse; clicking anywhere else selects the
    // group's anchor workspace (built-in sidebar behavior). Chevron only,
    // no folder icon. One glyph that ROTATES (right -> down on expand):
    // rotation animates as one motion with the accordion, and the fixed box
    // keeps the header height constant.
    Image("chevron.right")
      .font(11).weight("semibold").color("tertiary")
      .rotation(() => (isCollapsed(g()) ? 0 : 90))
      .frame({ width: 14, height: 16 })
      .onTap(() => toggleCollapse(g())),
    Text(() => g().name).font(13).weight("semibold").lineLimit(1).truncation("tail")
      .color(() => (isSelected(anchor()) ? "primary" : "secondary")),
    Spacer(),
  ])
    .paddingLeading(8)
    .paddingTrailing(10)
    .paddingVertical(7)
    .cornerRadius(8)
    .background(() => (isSelected(anchor()) ? "#7f7f7f3d" : null))
    .hoverBackground(() => (isSelected(anchor()) ? "#7f7f7f3d" : "#7f7f7f1c"))
    .frame({ maxWidth: "infinity" })
    .fixed()
    .block("h:" + groupId)
    .onTap(() => selectWorkspace(anchor()?.id))
    .onDoubleTap(() => setEditingId("h:" + groupId))
    .contextMenu([
      Button("Rename Group", () => setEditingId("h:" + groupId)),
      Button(() => (isCollapsed(g()) ? "Expand" : "Collapse"), () => toggleCollapse(g())),
      Button(() => (g().pinned ? "Unpin Group" : "Pin Group"), () =>
        cmux("workspace.group.action", { group_id: groupId, action: g().pinned ? "unpin" : "pin" })),
      Divider(),
      Button("Ungroup", groupAct("ungroup")),
      Button("Delete Group", groupAct("delete")).destructive(),
    ]);
}

// Identical geometry to groupHeader (chevron box, paddings, semibold 13)
// so entering/leaving rename changes nothing but the text becoming editable.
function groupEditRow(groupId) {
  const g = () => groupById(groupId);
  return HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(11).weight("semibold").color("tertiary")
      .rotation(() => (isCollapsed(g() ?? {}) ? 0 : 90))
      .frame({ width: 14, height: 16 }),
    TextField(() => g()?.name ?? "", {
      placeholder: "Group name",
      onSubmit: (t) => {
        const name = (t ?? "").trim();
        if (name) cmux("workspace.group.rename", { group_id: groupId, name });
        setEditingId(null);
      },
      onCancel: () => setEditingId(null),
    }).font(13).weight("semibold"),
  ])
    .paddingLeading(8)
    .paddingTrailing(10)
    .paddingVertical(7)
    .cornerRadius(8)
    .background("#7f7f7f3d")
    .frame({ maxWidth: "infinity" })
    .fixed();
}

// --- root ------------------------------------------------------------------------
sidebar(() =>
  VStack({ spacing: 4 }, [
  Reorderable(
    {
      items: flatEntries,
      key: (e) => e.id,
      spacing: 4,
      onMove: handleMove,
    },
    (e, key) => {
      const entry = e(); // kind, ids, and editing are stable per key
      if (entry.kind === "header") {
        return entry.editing ? groupEditRow(entry.groupId) : groupHeader(entry.groupId);
      }
      const w = () => (data.workspaces() ?? []).find((x) => x.id === entry.wsId);
      return entry.editing ? workspaceEditRow(w, e) : workspaceItem(w, e);
    }
  ),
  ]),
  { surface: "glass" }
)
