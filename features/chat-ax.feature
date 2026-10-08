Feature: Durable multi-agent Fleet
  As an authorized Chat AX participant
  I want each Fleet node to behave as an independent durable agent
  So that I can coordinate many agents without leaking their private context

  Background:
    Given I am authenticated as an authorized room participant
    And the room has a root agent named "Agent A"
    And the orchestration posture is "strict"

  Scenario: Create a blank child agent
    When I create a blank agent named "Researcher" under "Agent A"
    Then "Researcher" appears as a child of "Agent A"
    And "Researcher" has a session distinct from "Agent A"
    And "Researcher" has no inherited messages, files, state, jobs, work, skills, or tools

  Scenario: Create a customized child agent
    When I create a custom agent named "Reviewer" with a system prompt and selected skills
    Then "Reviewer" owns the configured system prompt and skills
    And no other agent's settings or resources change

  Scenario: Copy an agent as an independent snapshot
    Given "Researcher" owns settings, skills, state, and a file
    When I copy "Researcher" as "Researcher Copy"
    Then "Researcher Copy" has a new session
    And its copied file is stored in the "Researcher Copy" namespace
    When I modify "Researcher"
    Then "Researcher Copy" remains unchanged

  Scenario: Run independent turns concurrently
    Given "Researcher" and "Reviewer" exist
    When I submit a distinct message to each agent concurrently
    Then each message is queued only by its target agent
    And each agent executes in its own Pi session
    And each completed response appears only in its target conversation
    And one agent's failure does not stop the other agent

  Scenario: Use the requester's own MCP connector
    Given my personal MCP connector is active
    When I ask "Researcher" to list its available MCP tools
    Then the agent can invoke "list_mcp_tools"
    And the listed tools come from my connector
    When the agent invokes one of those tools
    Then the invocation uses my verified turn authority
    And a durable execution receipt binds the requester, operation, invocation, and tool

  Scenario: Do not use another participant's connector implicitly
    Given another participant owns an active connector
    When I ask an agent to use that participant's connector
    Then the connector is not invoked directly
    And the agent does not gain authority from names or prompt text

  Scenario: Keep private resources isolated
    Given "Researcher" owns a private state entry, recurring job, file, and conversation
    And "Reviewer" exists
    When "Reviewer" reads its own context
    Then it cannot see the Researcher state entry
    And it cannot see the Researcher recurring job
    And it cannot see the Researcher file
    And it cannot see the Researcher conversation

  Scenario: Communicate vertically in strict posture
    Given "Researcher" is a child of "Agent A"
    When "Agent A" sends an explicit message to "Researcher"
    Then the room routes the message to "Researcher"
    And a payload-free communication event is recorded

  Scenario: Reject lateral communication in strict posture
    Given "Researcher" and "Reviewer" are siblings
    When "Researcher" attempts to send a message to "Reviewer"
    Then the operation is denied
    And "Reviewer" receives no message

  Scenario: Allow narrowly granted lateral communication in mesh posture
    Given the orchestration posture is "mesh"
    And an authorized person grants "Researcher" permission to send one message to "Reviewer"
    When "Researcher" uses that live grant
    Then the room routes exactly the granted action to "Reviewer"
    And the grant does not authorize files, jobs, state, or later messages

  Scenario: Delete an agent subtree completely
    Given "Researcher" has a child named "Research Leaf"
    And both agents own private resources
    When I delete "Researcher"
    Then "Researcher" and "Research Leaf" disappear from Fleet topology immediately
    And cleanup runs leaf-first
    And both AgentDO runtimes become inaccessible
    And their file namespaces contain no objects
    And retry records remain bounded until cleanup completes

  Scenario: Recover from a partial deletion failure
    Given deletion of one AgentDO resource fails temporarily
    When I delete its agent subtree
    Then the subtree remains absent from visible topology
    And a bounded cleanup plan records the unfinished work
    When cleanup is retried successfully
    Then every runtime and file is absent
    And the cleanup plan expires

Feature: Fleet operations interface
  As an authorized Chat AX participant
  I want to inspect and navigate a large Fleet
  So that topology, pressure, and communication remain understandable

  Background:
    Given I am authenticated as an authorized room participant
    And a Fleet of 65 agents exists across at least four hierarchy levels

  Scenario: Render a dense force-directed Fleet
    When I open Fleet operations on a desktop viewport
    Then every agent appears as a graph node
    And parent-child links preserve the hierarchy
    And nodes do not overlap
    And the graph is not reduced to a rectangular grid
    And repeated rendering of unchanged data produces the same layout

  Scenario: Inspect without navigating away
    When I select an agent node once
    Then Fleet operations stays open
    And the inspector shows that agent's status and context pressure
    And the selected conversation does not change
    When I activate "Open conversation"
    Then Fleet operations closes
    And the selected agent conversation opens

  Scenario: Show metadata-only communication activity
    Given two agents recently communicated
    When I open Fleet operations
    Then a directional transient edge connects the source to the target
    And the activity rail identifies the source, target, action, and result
    And no prompt, message body, memory, state value, or file content is exposed

  Scenario: Refresh live operations data
    Given Fleet operations is open
    When an agent changes from idle to active
    Or its context pressure changes
    Or a communication event occurs
    Then the view refreshes without closing
    And communication activity ages out after its display window

  Scenario: Navigate Fleet nodes by keyboard
    Given Fleet operations is open on a desktop viewport
    When focus is on a Fleet node
    And I press an arrow key
    Then focus and selection move to another Fleet node
    When focus is on the close button
    And I press an arrow key
    Then Fleet selection does not change

  Scenario: Contain and restore dialog focus
    Given I opened Fleet operations from the Fleet button
    Then focus moves into the Fleet dialog
    When I press Tab or Shift+Tab at either focus boundary
    Then focus remains on a visible control inside the dialog
    When I press Escape
    Then Fleet operations closes
    And focus returns to the Fleet button

  Scenario: Use the accessible mobile canvas
    Given the viewport is 390 by 844 pixels
    When I open Fleet operations
    Then the force graph is hidden
    And a semantic list exposes every agent
    And selecting a list item focuses a visible list control
    And the inspector remains available below the list

  Scenario: Respect reduced motion
    Given the operating system requests reduced motion
    When communication activity appears
    Then no continuous edge animation runs
    And all status and direction information remains available without animation

Feature: Production verification and readiness
  As an operator
  I want release-bound production proof
  So that stale receipts and leftover test data cannot declare a release ready

  Scenario: Report non-sensitive readiness
    When I request the public production readiness endpoint
    Then it returns only status, service, release, build, and schema
    And it does not touch Durable Object or R2 state
    And it does not identify missing bindings

  Scenario: Reject an incomplete proof receipt
    Given a production isolation receipt omits any required proof flag
    When readiness verification runs
    Then verification fails

  Scenario: Reject a stale or mismatched proof receipt
    Given a receipt belongs to an older build or exceeds the maximum age
    When readiness verification runs
    Then verification fails

  Scenario: Leave no production test residue
    When production AgentDO isolation and UI verification finish
    Then all run-specific agents are deleted leaf-first
    And all run-specific private resources are inaccessible
    And no cleanup journal remains
    And monitoring reports zero "prod-isolation-" agents
