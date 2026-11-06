import CmuxSidebar
import CmuxSwiftRender
import Foundation
import Testing

#if canImport(cmux_DEV)
@testable import cmux_DEV
#elseif canImport(cmux)
@testable import cmux
#endif

@Suite("Custom sidebar native surface lifecycle", .serialized)
@MainActor
struct CustomSidebarSurfaceLifecycleTests {
    private func workspace() -> Workspace {
        Workspace(title: "Lifecycle test", initialTerminalStartsOnFirstVisit: true)
    }

    private func tabs(_ workspace: Workspace) -> [SwiftValue] {
        let snapshot = workspace.customSidebarWorkspaceSnapshot(index: 0, selectedId: workspace.id, unreadCount: 0)
        return CustomSidebarDataContextBuilder().workspaceValue(snapshot).member("tabs")?.iterationValues ?? []
    }

    @Test("Native lifecycle transitions reach custom tabs without a registry event")
    func transitionsDoNotRequireRegistry() throws {
        let workspace = workspace()
        let panelId = try #require(workspace.focusedPanelId)
        let transitions: [(AgentHibernationLifecycleState, String)] = [
            (.running, "running"),
            (.idle, "idle"),
            (.needsInput, "needs_input"),
            (.backgroundWorkPending, "background_work_pending"),
            (.unknown, "unknown")
        ]
        for (state, expected) in transitions {
            workspace.setAgentLifecycle(key: "pi", panelId: panelId, lifecycle: state)
            let tab = try #require(tabs(workspace).first { $0.member("id") == .string(panelId.uuidString) })
            #expect(tab.member("agentLifecycles")?.member("pi") == .string(expected))
        }
    }

    @Test("Idle in another terminal cannot overwrite a running terminal")
    func statesStayPanelScoped() throws {
        let workspace = workspace()
        let firstId = try #require(workspace.focusedPanelId)
        let pane = try #require(workspace.bonsplitController.focusedPaneId)
        let second = try #require(workspace.newTerminalSurface(inPane: pane, focus: false))
        workspace.setAgentLifecycle(key: "pi", panelId: firstId, lifecycle: .idle)
        workspace.setAgentLifecycle(key: "pi", panelId: second.id, lifecycle: .running)
        let projected = tabs(workspace)
        let first = try #require(projected.first { $0.member("id") == .string(firstId.uuidString) })
        let other = try #require(projected.first { $0.member("id") == .string(second.id.uuidString) })
        #expect(first.member("agentLifecycles")?.member("pi") == .string("idle"))
        #expect(other.member("agentLifecycles")?.member("pi") == .string("running"))
    }

    @Test("Cleared lifecycle is unknown to the custom sidebar")
    func clearedLifecycleIsEmpty() throws {
        let workspace = workspace()
        let panelId = try #require(workspace.focusedPanelId)
        workspace.setAgentLifecycle(key: "pi", panelId: panelId, lifecycle: .running)
        #expect(workspace.clearAgentLifecycle(key: "pi", panelId: panelId))
        let tab = try #require(tabs(workspace).first)
        #expect(tab.member("agentLifecycles") == .object([:]))
    }
}
