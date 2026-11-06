// Runs the real sidebar in cmux's reactive scene runtime; no app or socket needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'Packages/macOS/CmuxSwiftRenderUI/Sources/CmuxSwiftRenderUI/Resources/SidebarRuntime.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'Examples/CustomSidebars/folder-titles.js'), 'utf8');

function mount({lifecycle = 'idle', registryStatus = 'working', latestAt = 100, includeLifecycle = true} = {}) {
  const nodes = new Map();
  const ctx = vm.createContext({
    __host_applyOps(json) {
      for (const op of JSON.parse(json)) {
        if (op.op === 'create') nodes.set(op.id, {type: op.type});
        else if (op.op === 'update') nodes.get(op.id)[op.key] = op.value;
        else if (op.op === 'remove') nodes.delete(op.id);
      }
    },
    __host_action() {}, __host_log() {},
  });
  vm.runInContext(runtime, ctx);
  const tab = {id: 'panel-1', title: 'Pi session', focused: true, latestAt};
  if (includeLifecycle) tab.agentLifecycles = {pi: lifecycle};
  const ws = {id: 'ws-1', title: 'Project', directory: '/repo', selected: true,
    tabs: [tab], agents: [{id: 'session-1', kind: 'pi', panelId: tab.id,
      status: registryStatus, sinceEpoch: 1, lastActivityAt: 1}]};
  ctx.__setData('workspaces', JSON.stringify([ws]));
  ctx.__setData('groups', '[]');
  ctx.__setData('clock', JSON.stringify({epoch: 200, second: 1}));
  vm.runInContext(sidebar, ctx);
  return {
    nodes, ws,
    icon: () => [...nodes.values()].find(n => n.type === 'image' && n.systemName === 'brain.head.profile'),
    dot: () => [...nodes.values()].find(n => n.type === 'circle'),
    elapsed: () => [...nodes.values()].find(n => n.type === 'text' && n.monospaced && n.font === 11 && n.fixedSize),
    update() { ctx.__setData('workspaces', JSON.stringify([ws])); },
  };
}

test('a completed native lifecycle stops the logo despite a stale working registry', () => {
  const app = mount();
  assert.equal(app.icon().opacity, 1);
  assert.equal(app.icon().rotation, 0);
  assert.equal(app.elapsed().text, '');
});

test('native running and pending background work animate even if registry says idle', () => {
  for (const lifecycle of ['running', 'background_work_pending']) {
    const app = mount({lifecycle, registryStatus: 'idle'});
    assert.equal(app.icon().opacity, 0.3, lifecycle);
    assert.equal(app.icon().rotation, 45, lifecycle);
    assert.equal(app.elapsed().text, '1m', lifecycle);
  }
});

test('waiting and unknown lifecycle never reuse registry working state', () => {
  for (const lifecycle of ['needs_input', 'unknown']) {
    const app = mount({lifecycle});
    assert.equal(app.icon().opacity, 1, lifecycle);
    assert.equal(app.elapsed().text, '', lifecycle);
    assert.equal(app.dot().fill, lifecycle === 'needs_input' ? '#E8A33D' : 'clear');
  }
});

test('older hosts without native lifecycle show unknown activity', () => {
  const app = mount({includeLifecycle: false});
  assert.equal(app.icon().opacity, 1);
  assert.equal(app.elapsed().text, '');
});

test('native lifecycle changes update mounted rows without a registry event', () => {
  const app = mount({lifecycle: 'running'});
  assert.equal(app.icon().opacity, 0.3);
  app.ws.tabs[0].agentLifecycles.pi = 'idle';
  app.update();
  assert.equal(app.icon().opacity, 1);
  assert.equal(app.icon().rotation, 0);
  assert.equal(app.elapsed().text, '');
  app.ws.tabs[0].agentLifecycles.pi = 'needs_input';
  app.update();
  assert.equal(app.dot().fill, '#E8A33D');
  app.ws.tabs[0].agentLifecycles.pi = 'running';
  app.update();
  assert.equal(app.icon().opacity, 0.3);
  assert.equal(app.dot().fill, 'clear');
});

test('each terminal uses only its own lifecycle and native prompt timestamp', () => {
  const app = mount({lifecycle: 'running', latestAt: 190});
  assert.equal(app.elapsed().text, '10s');
  app.ws.tabs[0].agentLifecycles = {pi: 'idle'};
  app.ws.tabs.push({id: 'panel-2', title: 'Other agent', agentLifecycles: {pi: 'running'}});
  app.update();
  assert.equal(app.icon().opacity, 1);
  assert.equal(app.elapsed().text, '');
});

test('manual workspace loaders do not animate an idle agent', () => {
  const app = mount();
  app.ws.tabs[0].agentLifecycles['manual:build'] = 'running';
  app.update();
  assert.equal(app.icon().opacity, 1);
});
