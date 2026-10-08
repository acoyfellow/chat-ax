<script>
  import { ArrowDown, Command, LoaderCircle, Moon, Paperclip, SendHorizontal, Square, Sun, X } from '@lucide/svelte';
  import { marked, Renderer } from 'marked';
  import { onMount, untrack } from 'svelte';
  import { maximumVisibleParticipants } from '../presence';
  import { createUiStressFixture } from '../ui-stress';
  import AgentAvatar from './AgentAvatar.svelte';
  import AgentTree from './AgentTree.svelte';
  import Modal from './Modal.svelte';
  import { coalescedTask, openLiveConnection } from './live-connection';

  const markdownRenderer = new Renderer();
  const escapeMarkup = (value) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const escapeAttribute = (value) => escapeMarkup(value).replaceAll('"', '&quot;');
  markdownRenderer.link = function (token) {
    const label = this.parser.parseInline(token.tokens);
    if (!/^(https?:|mailto:|\/)/i.test(token.href)) return label;
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
    return `<a href="${escapeAttribute(token.href)}"${title} rel="noreferrer">${label}</a>`;
  };
  markdownRenderer.image = (token) => escapeMarkup(token.text);
  marked.setOptions({ gfm: true, breaks: true, renderer: markdownRenderer });

  let { initialState, viewer, connector, stressFixture = false, threadId = '', threadTitle = 'Thread lens', threadPath = 'Thread lens' } = $props();
  const initialThreadId = untrack(() => threadId || initialState.threadTree?.rootId || '');
  const initialThreadNodes = untrack(() => initialState.threadTree?.nodes ?? []);
  let treeNodes = $state(initialThreadNodes);
  let collapsedNodes = $state(new Set());
  let treeOpen = $state(false);
  let editingAgentName = $state(false);
  let agentNameDraft = $state('');
  const initialThreadNode = initialThreadNodes.find((node) => node.id === initialThreadId);
  const initialPath = (() => { const result = []; let current = initialThreadNode; while (current) { result.unshift(current); current = initialThreadNodes.find((node) => node.id === current.parentId); } return result; })();
  let state = $state(untrack(() => initialState));
  let connectorState = $state(untrack(() => connector));
  let threadLens = $state({ current: { id: initialThreadId, title: initialThreadNode?.title || 'Thread lens', avatarSeed: initialThreadNode?.avatarSeed || initialThreadId, status: initialThreadNode?.status || 'idle' }, path: initialPath, children: untrack(() => initialState.threadTree?.nodes?.filter((node) => node.parentId === initialThreadId) || []) });
  let threadLensTitle = $state(untrack(() => threadPath || threadTitle));
  let draft = $state('');
  let sending = $state(false);
  let savingSettings = $state(false);
  let settingsOpen = $state(false);
  let paletteTab = $state('account');
  let theme = $state('light');
  let error = $state('');
  let threadLoading = $state(false);
  let threadLoadVersion = 0;
  let refreshInFlight = false;
  let selectedAttachmentIds = $state([]);
  let uploading = $state(false);
  let approvingApprovalId = $state('');
  let personRequestActionId = $state('');
  let atBottom = $state(true);
  let unreadMessages = $state(0);
  let followEnabled = true;
  let scrollReleaseTimer;
  let stateKey = $state('');
  let stateValue = $state('');
  let jobName = $state('');
  let jobPrompt = $state('');
  let jobInterval = $state(3600);
  let pushEnabled = $state(false);
  let editingSettings = $state(false);
  let mounted = $state(false);
  let stressMode = $state(untrack(() => stressFixture));
  let now = $state(Date.now());
  let systemPromptDraft = $state(untrack(() => initialState.settings.systemPrompt));
  let skillName = $state('');
  let skillDescription = $state('');
  let skillBody = $state('');
  let personalAvatarSeed = $state('');
  let feed;

  const initials = (name) =>
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const color = (id) => {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 46% 43%)`;
  };

  function randomAvatarSeed(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  function randomizePersonalAvatar() {
    personalAvatarSeed = randomAvatarSeed(viewer.id);
    localStorage.setItem(`chat-ax-avatar-${viewer.id}`, personalAvatarSeed);
    void heartbeat();
  }

  function randomizeAgentAvatar() {
    saveSetting('agentAvatarSeed', randomAvatarSeed(threadLens.current.title));
  }

  const repliedTo = (message) =>
    message.replyTo
      ? state.messages.find((candidate) => candidate.id === message.replyTo)
      : undefined;

  const messageTime = (createdAt) =>
    new Date(createdAt).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: mounted ? undefined : 'UTC',
    });

  function renderMarkdown(text) {
    const source = escapeMarkup(text ?? '');
    try {
      return String(marked.parse(source));
    } catch {
      return `<p>${source}</p>`;
    }
  }

  function toolName(name) {
    return name.split('__').at(-1)?.replaceAll('_', ' ') ?? name;
  }

  let expandedTools = $state({});

  function toolTarget(argumentsText) {
    if (!argumentsText) return '';
    try {
      const parsed = JSON.parse(argumentsText);
      const target = parsed?.toolName ?? parsed?.tool ?? parsed?.name ?? parsed?.skill ?? parsed?.path;
      return typeof target === 'string' ? target.slice(0, 60) : '';
    } catch {
      return '';
    }
  }

  function approvalStatusLabel(status) {
    return {
      pending: 'Awaiting approval',
      denied: 'Denied — nothing executed',
      running: 'Running',
      'not-executed': 'Not executed',
      succeeded: 'Approved — result shared',
      failed: 'Failed — approval consumed',
      'outcome-unknown': 'Error — outcome unknown',
    }[status] ?? status;
  }

  async function approveMcpAction(id) {
    if (approvingApprovalId) return;
    approvingApprovalId = id;
    try {
      await mutate('POST', `/api/mcp-approvals/${id}/approve`, {});
    } finally {
      approvingApprovalId = '';
    }
  }

  async function denyMcpAction(id) {
    if (approvingApprovalId) return;
    approvingApprovalId = id;
    try {
      await mutate('POST', `/api/mcp-approvals/${id}/deny`, {});
    } finally {
      approvingApprovalId = '';
    }
  }

  function elapsed(startedAt, completedAt) {
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return '';
    const completed = new Date(completedAt).getTime();
    const end = Number.isFinite(completed) ? completed : now;
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function onlineParticipants() {
    const online = state.online ?? [];
    return online.some((participant) => participant.id === viewer.id)
      ? online
      : [
          {
            id: viewer.id,
            name: viewer.name,
            email: viewer.email,
            avatarUrl: viewer.avatarUrl,
            lastSeenAt: new Date(now).toISOString(),
          },
          ...online,
        ];
  }

  async function heartbeat() {
    if (stressMode) return;
    try {
      const response = await fetch(`/api/presence?avatarSeed=${encodeURIComponent(personalAvatarSeed || viewer.id)}`, { method: 'POST', keepalive: true });
      if (!response.ok) return;
      const result = await response.json();
      state.online = result.online;
    } catch {}
  }

  function leaveRoom() {
    if (!stressMode) navigator.sendBeacon('/api/presence/leave');
  }

  async function refreshFleet() {
    try {
      const response = await fetch('/api/fleet');
      if (!response.ok) return;
      const result = await response.json();
      treeNodes = result.agents;
      if (!treeNodes.some((node) => node.id === threadLens.current.id) && !threadLoading) await loadThreadLens();
    } catch {}
  }

  async function loadThreadLens(nodeId = '') {
    const loadVersion = ++threadLoadVersion;
    threadLoading = true;
    try {
      let response = await fetch(`/api/threads${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`);
      if (response.status === 404 && nodeId) response = await fetch('/api/threads');
      if (!response.ok) throw new Error('Conversation unavailable');
      const next = await response.json();
      if (loadVersion !== threadLoadVersion) return '';
      const snapshotResponse = await fetch(`/api/messages?threadId=${encodeURIComponent(next.current.id)}`);
      if (!snapshotResponse.ok) throw new Error('Conversation unavailable');
      const snapshot = await snapshotResponse.json();
      if (loadVersion !== threadLoadVersion) return '';
      threadLensTitle = next.path.map((node) => node.title).join(' / ') || next.current.title;
      const switchedAgent = threadLens.current.id !== next.current.id;
      threadLens.current = next.current;
      threadLens.path = next.path;
      threadLens.children = next.children;
      applySnapshot(snapshot, false);
      if (switchedAgent) liveReconnect();
      if (nodeId && next.current.id !== nodeId)
        history.replaceState({}, '', `/?thread=${encodeURIComponent(next.current.id)}`);
      error = '';
      return next.current.id;
    } catch {
      if (loadVersion === threadLoadVersion)
        error = 'That conversation could not be loaded. Your current conversation is still open.';
      return '';
    } finally {
      if (loadVersion === threadLoadVersion) threadLoading = false;
    }
  }

  async function openThread(nodeId) {
    const loadedId = await loadThreadLens(nodeId);
    if (loadedId === nodeId) history.pushState({}, '', `/?thread=${encodeURIComponent(nodeId)}`);
  }

  function pathToDepth(id) { let depth = 0; let parentId = treeNodes.find((node) => node.id === id)?.parentId ?? null; while (parentId) { depth += 1; parentId = treeNodes.find((node) => node.id === parentId)?.parentId ?? null; } return depth; }
  function hasChildren(id) { return treeNodes.some((node) => node.parentId === id); }
  function isHidden(node) { let parentId = node.parentId; while (parentId) { if (collapsedNodes.has(parentId)) return true; parentId = treeNodes.find((candidate) => candidate.id === parentId)?.parentId ?? null; } return false; }
  function toggleCollapsed(id) { collapsedNodes = new Set(collapsedNodes.has(id) ? [...collapsedNodes].filter((value) => value !== id) : [...collapsedNodes, id]); }

  async function deleteThread(node) {
    if (node.id === initialState.threadTree?.rootId || !confirm(`Delete ${node.title} and its children?`)) return;
    const response = await fetch('/api/threads', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: node.id }) });
    if (response.ok) { treeNodes = treeNodes.filter((candidate) => candidate.id !== node.id && !isDescendant(candidate, node.id)); if (threadLens.current.id === node.id) location.href = `/?thread=${encodeURIComponent(initialState.threadTree.rootId)}`; }
  }
  function isDescendant(node, ancestorId) { let parentId = node.parentId; while (parentId) { if (parentId === ancestorId) return true; parentId = treeNodes.find((candidate) => candidate.id === parentId)?.parentId ?? null; } return false; }

  function beginAgentRename() { agentNameDraft = threadLens.current.title; editingAgentName = true; }
  async function renameThread(node, title = agentNameDraft) {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === node.title) { editingAgentName = false; return; }
    const response = await fetch('/api/threads', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: node.id, title: nextTitle }) });
    if (response.ok) { const result = await response.json(); treeNodes = treeNodes.map((candidate) => candidate.id === node.id ? result.node : candidate); threadLens.current = result.node; await loadThreadLens(threadLens.current.id); }
    editingAgentName = false;
  }

  async function createThread(kind, referenceId) {
    const response = await fetch('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'subagent' ? { parentId: referenceId } : { siblingOf: referenceId }) });
    if (!response.ok) return;
    const result = await response.json();
    treeNodes = [...treeNodes.filter((node) => node.id !== result.node.id), result.node];
    await openThread(result.node.id);
  }

  function applySnapshot(next, force = false) {
    const previousCount = state.messages.length;
    if (!editingSettings || force) systemPromptDraft = next.settings.systemPrompt;
    state = editingSettings && !force
      ? { ...next, agentState: state.agentState, jobs: state.jobs }
      : next;
    const added = Math.max(0, state.messages.length - previousCount);
    if (followEnabled) window.requestAnimationFrame(() => {
      if (followEnabled) scrollLatest('instant');
    });
    else if (added > 0) unreadMessages += added;
  }

  const liveFallbackRefreshMilliseconds = 30_000;
  const offlineRefreshMilliseconds = 15_000;
  const hiddenRefreshMilliseconds = 60_000;
  let liveConnected = $state(false);

  function refreshDelay() {
    if (document.visibilityState === 'hidden') return hiddenRefreshMilliseconds;
    return liveConnected ? liveFallbackRefreshMilliseconds : offlineRefreshMilliseconds;
  }

  function applyLiveProgress(message) {
    if (typeof message.messageId !== 'string' || typeof message.text !== 'string' || !Array.isArray(message.tools)) return;
    const { messageId, text, tools } = message;
    let found = false;
    const messages = state.messages.map((candidate) => {
      if (candidate.id !== messageId) return candidate;
      found = true;
      return { ...candidate, text, tools };
    });
    if (!found) return;
    state = { ...state, messages };
    if (followEnabled) window.requestAnimationFrame(() => {
      if (followEnabled) scrollLatest('instant');
    });
  }

  const refreshFromLiveSignal = coalescedTask(() => refresh());

  let liveReconnect = () => {};
  let snapshotEtag = '';
  let snapshotEtagThread = '';

  async function refresh(force = false) {
    if (stressMode || refreshInFlight) return;
    refreshInFlight = true;
    const requestedThreadId = threadLens?.current?.id || '';
    const loadVersion = threadLoadVersion;
    try {
      const response = await fetch(`/api/messages${requestedThreadId ? `?threadId=${encodeURIComponent(requestedThreadId)}` : ''}`, {
        headers: snapshotEtag && snapshotEtagThread === requestedThreadId && !force ? { 'if-none-match': snapshotEtag } : {},
      });
      if (response.status === 304 || !response.ok) return;
      const snapshot = await response.json();
      snapshotEtag = response.headers.get('etag') ?? '';
      snapshotEtagThread = requestedThreadId;
      if (loadVersion !== threadLoadVersion || requestedThreadId !== threadLens.current.id) return;
      applySnapshot(snapshot, force);
    } catch {}
    finally {
      refreshInFlight = false;
    }
  }

  function updateScrollPosition() {
    if (!feed) return;
    const reachedBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    atBottom = reachedBottom;
    if (reachedBottom) unreadMessages = 0;
  }

  function stopFollowing(event) {
    if (!event || event.deltaY === 0) return;
    if (event.deltaY > 0 && feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120) {
      followEnabled = true;
      return;
    }
    followEnabled = false;
    window.clearTimeout(scrollReleaseTimer);
    atBottom = false;
  }

  function scrollLatest(behavior = 'smooth') {
    if (!feed) return;
    followEnabled = true;
    window.clearTimeout(scrollReleaseTimer);
    feed.scrollTo({ top: feed.scrollHeight, behavior });
    atBottom = true;
    unreadMessages = 0;
    scrollReleaseTimer = window.setTimeout(() => {
      updateScrollPosition();
    }, behavior === 'smooth' ? 500 : 0);
  }

  function agentScopedUrl(url) {
    const agentId = threadLens?.current?.id;
    if (!agentId) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}threadId=${encodeURIComponent(agentId)}`;
  }

  async function mutate(method, url, body) {
    error = '';
    const response = await fetch(agentScopedUrl(url), {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error ?? 'The change could not be saved');
    }
    await refresh(true);
  }

  async function upload(event) {
    const files = [...event.currentTarget.files];
    if (files.length === 0 || uploading) return;
    uploading = true;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set('file', file);
        const response = await fetch(agentScopedUrl('/api/files'), { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `Could not upload ${file.name}`);
        selectedAttachmentIds = [...selectedAttachmentIds, result.file.id];
      }
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Files could not be uploaded';
    } finally {
      uploading = false;
      event.currentTarget.value = '';
    }
  }

  async function safely(action) {
    try {
      await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The change could not be saved';
    }
  }

  async function createStateEntry() {
    await mutate('POST', '/api/agent-state', { key: stateKey, value: stateValue });
    stateKey = '';
    stateValue = '';
  }

  async function createJob() {
    await mutate('POST', '/api/jobs', {
      name: jobName,
      prompt: jobPrompt,
      intervalSeconds: Number(jobInterval),
      maxRuns: null,
    });
    jobName = '';
    jobPrompt = '';
  }

  async function updatePersonRequest(requestId, action) {
    if (personRequestActionId) return;
    personRequestActionId = requestId;
    try {
      await mutate('POST', `/api/person-requests/${requestId}/${action}`, {});
    } finally {
      personRequestActionId = '';
    }
  }

  function decodeVapidKey(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const raw = atob(`${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function enablePush() {
    if (!state.pushPublicKey) throw new Error('Push is not configured');
    const registration = await navigator.serviceWorker.register('/sw.js');
    if (!registration.pushManager) throw new Error('This browser does not support Web Push');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(state.pushPublicKey),
    });
    await mutate('POST', '/api/push-subscriptions', subscription.toJSON());
    pushEnabled = true;
  }

  async function disconnectConnector() {
    const response = await fetch('/api/connectors/mcp/disconnect', { method: 'POST' });
    if (!response.ok) throw new Error('The connector could not be disconnected');
    connectorState = { ...connectorState, connected: false };
  }

  async function disablePush() {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      await mutate('DELETE', '/api/push-subscriptions', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    pushEnabled = false;
  }

  async function saveSetting(field, value) {
    if (state.settings[field] === value || savingSettings) return;
    savingSettings = true;
    error = '';
    try {
      const response = await fetch(`/api/settings${threadLens?.current?.id ? `?threadId=${encodeURIComponent(threadLens.current.id)}` : ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) throw new Error('Room settings could not be changed');
      const result = await response.json();
      state.settings = result.settings;
      if (field === 'agentAvatarSeed' && threadLens.current.id) {
        const nodeResponse = await fetch('/api/threads', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: threadLens.current.id, avatarSeed: value }) });
        if (nodeResponse.ok) { const nodeResult = await nodeResponse.json(); threadLens.current = nodeResult.node; treeNodes = treeNodes.map((node) => node.id === nodeResult.node.id ? nodeResult.node : node); }
      }
      systemPromptDraft = result.settings.systemPrompt;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Room settings could not be changed';
    } finally {
      savingSettings = false;
    }
  }

  const roomMessageCount = () => state.messages.length;

  function togglePalette() {
    settingsOpen = !settingsOpen;
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('chat-ax-theme', theme);
  }

  function sendButtonLabel() {
    if (threadLoading) return 'Loading conversation';
    return sending ? 'Sending message' : 'Send message';
  }

  async function send() {
    if (stressMode) return;
    const text = draft.trim();
    if (!text || sending || threadLoading) return;
    sending = true;
    error = '';
    draft = '';
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, attachmentIds: selectedAttachmentIds, threadId: threadLens?.current?.id || undefined }),
      });
      if (!response.ok) throw new Error('Message could not be sent');
      selectedAttachmentIds = [];
      await refresh();
    } catch (cause) {
      draft = text;
      error = cause instanceof Error ? cause.message : 'Message could not be sent';
    } finally {
      sending = false;
    }
  }

  function keydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  onMount(() => {
    theme = localStorage.getItem('chat-ax-theme') === 'dark' ? 'dark' : 'light';
    personalAvatarSeed = localStorage.getItem(`chat-ax-avatar-${viewer.id}`) || viewer.id;
    document.documentElement.dataset.theme = theme;
    mounted = true;
    threadLensTitle = threadPath || threadTitle;
    const stressCount = Number(new URLSearchParams(location.search).get('stress-ui'));
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (!stressMode && loopback && stressCount > 0) {
      const fixture = createUiStressFixture(
        state.strategies.map((strategy) => strategy.id),
        Math.min(2_000, Math.floor(stressCount)),
        Date.now(),
        viewer,
      );
      state = { ...state, ...fixture, active: 0, waiting: 0 };
      stressMode = true;
      window.setTimeout(() => scrollLatest('smooth'), 0);
    }
    const scheduleFleetRefresh = coalescedTask(refreshFleet);
    const fleetEvents = stressMode ? null : openLiveConnection({
      path: () => '/api/fleet/events?after=latest',
      onMessage: (message) => {
        if (message.type === 'fleet') scheduleFleetRefresh();
      },
    });
    const agentLive = stressMode ? null : openLiveConnection({
      path: () => `/api/agents/${encodeURIComponent(threadLens.current.id || initialState.threadTree?.rootId || '')}/live`,
      onOpen: () => {
        liveConnected = true;
        refreshFromLiveSignal();
      },
      onDown: () => (liveConnected = false),
      onMessage: (message) => {
        if (message.type === 'progress') applyLiveProgress(message);
        if (message.type === 'changed') refreshFromLiveSignal();
      },
    });
    liveReconnect = () => agentLive?.reconnect();
    let refreshTimer = 0;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        await refresh();
        scheduleRefresh();
      }, refreshDelay());
    };
    scheduleRefresh();
    const elapsedTimer = window.setInterval(() => (now = Date.now()), 1_000);
    const presenceTimer = window.setInterval(heartbeat, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        heartbeat();
        void refresh().then(scheduleRefresh);
      }
    };
    window.addEventListener('pagehide', leaveRoom);
    document.addEventListener('visibilitychange', onVisibilityChange);
    heartbeat();
    navigator.serviceWorker
      ?.getRegistration()
      .then((registration) => registration?.pushManager?.getSubscription())
      .then(async (subscription) => {
        pushEnabled = Boolean(subscription);
        if (subscription) {
          await fetch('/api/push-subscriptions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(subscription.toJSON()),
          });
        }
      })
      .catch(() => undefined);
    const onKeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
      }
      if (event.key === 'Escape' && settingsOpen) settingsOpen = false;
    };
    const onPopState = async () => {
      const previousId = threadLens.current.id;
      const requestedId = new URLSearchParams(location.search).get('thread') || '';
      const loadedId = await loadThreadLens(requestedId);
      if (!loadedId)
        history.replaceState({}, '', `/?thread=${encodeURIComponent(previousId)}`);
    };
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', onPopState);
    treeOpen = new URLSearchParams(location.search).has('fleet');
    refresh();
    loadThreadLens(new URLSearchParams(location.search).get('thread') || '');
    return () => {
      fleetEvents?.close();
      agentLive?.close();
      window.clearTimeout(refreshTimer);
      window.clearInterval(elapsedTimer);
      window.clearInterval(presenceTimer);
      window.removeEventListener('pagehide', leaveRoom);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('popstate', onPopState);
    };
  });

</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet" referrerpolicy="no-referrer" />
</svelte:head>

<main class:drawer-open={settingsOpen}>
  {#if false && threadLens}
    <aside class="thread-sidebar" aria-label="Conversation lens">
      <div class="thread-sidebar-heading"><span>Agents</span><button class="add-agent" type="button" aria-label="Add agent" onclick={() => createThread('subagent', threadLens.current.id)}>+ Add agent</button></div>
      <div class="agent-tree">
        {#each treeNodes as node (node.id)}
          {#if !isHidden(node)}
            <div class:thread-selected={node.id === threadLens.current.id} class="thread-row" style={`--depth: ${pathToDepth(node.id)}`}>
              {#if hasChildren(node.id)}<button class="tree-toggle" aria-label={collapsedNodes.has(node.id) ? 'Expand agent' : 'Collapse agent'} onclick={() => toggleCollapsed(node.id)}>{collapsedNodes.has(node.id) ? '›' : '⌄'}</button>{:else}<span class="tree-spacer"></span>{/if}
              <button class="thread-agent" type="button" ondblclick={() => { agentNameDraft = node.title; editingAgentName = true; }} onclick={() => openThread(node.id)}><AgentAvatar hash={node.avatarSeed} size={22} /><span>{node.title}</span></button>
              <span class="thread-status" data-status={node.status}></span><button class="thread-delete" aria-label={`Delete ${node.title}`} onclick={() => deleteThread(node)}>×</button>
            </div>
          {/if}
        {/each}
      </div>
      <button class="thread-child add-agent-button" type="button" onclick={() => createThread('subagent', threadLens.current.id)}>+ Add agent</button>
    </aside>
  {/if}
  <header>
    <button class="agent-orchestrator-button" type="button" aria-label="Open agent fleet" onclick={() => (treeOpen = true)}><AgentAvatar hash={threadLens.current.avatarSeed || state.settings.agentAvatarSeed} size={36} /></button>
    <button class="agent-name-title" type="button" ondblclick={beginAgentRename}>{threadLens.current.title}</button>
    {#if stressMode}<div class="stress-badge">{state.messages.length} fixture messages · {state.strategies.length} strategies</div>{/if}

    <div class="presence" role="status" aria-label={`${onlineParticipants().length} people online`}>
      <div class="presence-stack">
        {#each onlineParticipants().slice(0, maximumVisibleParticipants) as participant (participant.id)}
          <div class="presence-avatar" data-participant-id={participant.id} style:background={color(participant.id)} title={participant.name}>
            {#if participant.avatarUrl}
              <img src={participant.avatarUrl} alt="" referrerpolicy="no-referrer" />
            {:else}
              <AgentAvatar hash={participant.avatarSeed || (participant.id === viewer.id ? personalAvatarSeed : '') || participant.id} size={25} options={{ detail: 'none' }} />
            {/if}
          </div>
        {/each}
        {#if onlineParticipants().length > maximumVisibleParticipants}
          <div class="presence-more">+{onlineParticipants().length - maximumVisibleParticipants}</div>
        {/if}
      </div>
      <span class="presence-label">
        {onlineParticipants().length === 1
          ? state.active ? 'Just you · Agent responding' : 'Just you'
          : state.active ? `${onlineParticipants().length} online · Agent responding` : `${onlineParticipants().length} online`}
      </span>
    </div>
    <button class="settings-button" aria-label="Open command palette" aria-expanded={settingsOpen} title="Command palette (⌘K)" onclick={togglePalette}>
      <Command size={18} aria-hidden="true" />
      <kbd>⌘K</kbd>
    </button>
  </header>

  <section class="feed" role="log" aria-label="Conversation" bind:this={feed} aria-live="polite" onscroll={updateScrollPosition} onwheel={stopFollowing}>
    <div class="conversation">
      {#if threadLens.current.id === initialState.threadTree?.rootId}
        <article class="message assistant welcome">
          <AgentAvatar hash={threadLens.current.avatarSeed || state.settings.agentAvatarSeed} size={32} />
          <div class="body">
            <div class="meta"><strong>Agent</strong></div>
            <p>I’m here. This is one shared conversation for your whole team.</p>
          </div>
        </article>
      {/if}
      {#if state.messages.length === 0 && threadLens.current.id !== initialState.threadTree?.rootId}
        <article class="agent-empty-state">
          <AgentAvatar hash={threadLens.current.avatarSeed || state.settings.agentAvatarSeed} size={56} />
          <h2>{threadLens.current.title}</h2>
          <p>This agent is ready for its first assignment.</p>
          <button type="button" onclick={() => document.querySelector('textarea[aria-label="Message the agent"]')?.focus()}>Start a conversation</button>
        </article>
      {/if}

      {#each state.messages as message (message.id)}
        <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'} class:pending={message.status === 'queued'} class:active={message.status === 'active'} class="message">
          {#if message.role === 'assistant'}
            <AgentAvatar hash={threadLens.current.avatarSeed || state.settings.agentAvatarSeed} size={32} />
          {:else}
            <div class="avatar" style:background={color(message.authorId)}>
              {#if message.authorId === viewer.id && viewer.avatarUrl}
                <img src={viewer.avatarUrl} alt={viewer.name} referrerpolicy="no-referrer" />
              {:else if message.authorId === viewer.id}
                <AgentAvatar hash={personalAvatarSeed || viewer.id} size={32} />
              {:else if message.avatarUrl}
                <img src={message.avatarUrl} alt={message.authorName} referrerpolicy="no-referrer" />
              {:else}
                {initials(message.authorName)}
              {/if}
            </div>
          {/if}
          <div class="body">
            <div class="meta">
              <strong>{message.authorName}</strong>
              {#if message.authorEmail}<span class="author-email">{message.authorEmail}</span>{/if}
              <time>{messageTime(message.createdAt)}</time>
              {#if message.status === 'queued'}<span class="state">Waiting</span>{/if}
              {#if message.status === 'active' && message.role === 'user'}
                <span class="response-indicator" role="status" aria-label="Agent is responding" title="Agent is responding"><LoaderCircle size={14} class="spin" aria-hidden="true" /></span>
              {:else if message.status === 'active'}
                <span class="state active-state">Agent is responding</span>
              {/if}
              {#if message.status === 'error'}<span class="state error-state">Failed</span>{/if}
              {#if message.role === 'assistant' && message.status === 'active'}
                <button type="button" class="stop-button" aria-label="Stop response" title="Stop response" onclick={() => safely(() => mutate('POST', `/api/messages/${message.id}/cancel${threadLens?.current?.id ? `?threadId=${encodeURIComponent(threadLens.current.id)}` : ''}`, {}))}><Square size={12} aria-hidden="true" /></button>
              {/if}
            </div>
            {#if message.role === 'assistant' && repliedTo(message)}
              <div class="reply">Replying to {repliedTo(message).authorName}</div>
            {/if}
            {#if message.role === 'assistant'}
              {#if message.reasoning}
                <details class="reasoning">
                  <summary>
                    {#if message.status === 'active'}<LoaderCircle size={13} class="spin" aria-hidden="true" />{/if}
                    Thinking
                  </summary>
                  <div>{message.reasoning}</div>
                </details>
              {/if}
              {#if message.tools?.length}
                <div class="tool-activity">
                  {#each message.tools as tool (tool.id)}
                    <details class:error-tool={tool.status === 'error'} open={expandedTools[tool.id] ?? tool.status === 'error'} ontoggle={(event) => { expandedTools[tool.id] = event.currentTarget.open; }}>
                      <summary>
                        {#if tool.status === 'running'}<LoaderCircle size={13} class="spin" aria-hidden="true" />{:else}<span class="tool-dot"></span>{/if}
                        <span>{toolName(tool.name)}{#if toolTarget(tool.arguments)}<span class="tool-target"> · {toolTarget(tool.arguments)}</span>{/if}</span>
                        {#if elapsed(tool.startedAt, tool.completedAt)}<time>{elapsed(tool.startedAt, tool.completedAt)}</time>{/if}
                      </summary>
                      <div class="tool-detail">
                        {#if tool.arguments}<div class="tool-label">Input</div><pre>{tool.arguments}</pre>{/if}
                        {#if tool.result}<div class="tool-label">{tool.status === 'error' ? 'Error' : 'Output'}</div><pre>{tool.result}</pre>{/if}
                        {#if !tool.arguments && !tool.result}<div class="tool-label">{tool.status === 'running' ? 'Running…' : 'No details were recorded for this call.'}</div>{/if}
                      </div>
                    </details>
                  {/each}
                </div>
              {/if}
              {#if message.status === 'active'}
                <div class="thinking" role="status" aria-label="Agent is responding">
                  <span></span><span></span><span></span>
                </div>
              {/if}
              {#if message.text}
                <div class="markdown">{@html renderMarkdown(message.text)}</div>
              {/if}
            {:else}
              <p>{message.text}</p>
            {/if}
            {#each state.personRequests?.filter((request) => request.initiatingMessageId === message.id) ?? [] as request (request.id)}
              <section class="person-request" aria-label="Review request" data-request-id={request.id}>
                <strong>{request.title}</strong>
                {#if request.resourceUrl}<a href={request.resourceUrl} target="_blank" rel="noreferrer">{request.resourceUrl}</a>{/if}
                <p>Requested by {request.requesterEmail} · Assigned to {request.recipientEmail}</p>
                <p role="status">Status: {request.status === 'accepted' ? request.runMessageId ? 'Reviewing' : 'Accepted — starting review' : request.status}</p>
                {#if request.provenance}
                  <p>Method: {request.provenance.skill} · {request.provenance.recipe} v{request.provenance.recipeVersion} · {request.provenance.recipeDigest.slice(0, 12)}</p>
                {/if}
                {#if (request.status === 'pending' || (request.status === 'accepted' && !request.runMessageId)) && request.recipientEmail === viewer.email}
                  <div class="approval-actions">
                    <button type="button" disabled={personRequestActionId === request.id} aria-label={request.status === 'pending' ? 'Accept review request' : 'Retry review request'} onclick={() => safely(() => updatePersonRequest(request.id, 'accept'))}>{personRequestActionId === request.id ? request.status === 'pending' ? 'Accepting…' : 'Retrying…' : request.status === 'pending' ? 'Accept' : 'Retry review'}</button>
                    {#if request.status === 'pending'}
                      <button type="button" class="quiet danger" disabled={personRequestActionId === request.id} aria-label="Decline review request" onclick={() => safely(() => updatePersonRequest(request.id, 'decline'))}>Decline</button>
                    {/if}
                  </div>
                {:else if request.status === 'pending'}
                  <p>Waiting for {request.recipientEmail}.</p>
                {/if}
                {#if request.response}<div class="markdown">{@html renderMarkdown(request.response)}</div>{/if}
              </section>
            {/each}
            {#each state.mcpApprovals ?? [] as approval (approval.id)}
              {#if approval.operationId === message.id}
                <section aria-label="Connector action approval">
                  <strong>{approval.toolName}</strong>
                  <pre>{approval.argumentsJson}</pre>
                  <p>Requester: {approval.requesterEmail}. Connector owner: {approval.connectorOwnerEmail}. Approver: {approval.connectorOwnerEmail}.</p>
                  <p>Status: {approvalStatusLabel(approval.status)}. The result will be shared with everyone in this workspace.</p>
                  {#if approval.actorId !== viewer.id && approval.status === 'pending'}
                    <p role="status">Waiting for {approval.connectorOwnerEmail} to approve.</p>
                  {/if}
                  {#if approval.status === 'outcome-unknown'}
                    <p>The action may already have happened. Do not repeat it. Check the external service before requesting another action.</p>
                  {:else if approval.status === 'not-executed'}
                    <p>No external request has been dispatched. This approval is spent and will not run automatically.</p>
                  {:else if approval.status === 'failed'}
                    <p>The connector rejected the action or it failed after approval. This approval cannot be reused.</p>
                  {/if}
                  {#if approval.status === 'pending' && approval.actorId === viewer.id}
                    <div class="approval-actions">
                      <button type="button" disabled={approvingApprovalId === approval.id} aria-label="Approve connector action" onclick={() => safely(() => approveMcpAction(approval.id))}>{approvingApprovalId === approval.id ? 'Working…' : `Allow ${approval.requesterEmail} to run this with my connector`}</button>
                      <button type="button" class="quiet danger" disabled={approvingApprovalId === approval.id} aria-label="Deny connector action" onclick={() => safely(() => denyMcpAction(approval.id))}>Deny</button>
                    </div>
                  {:else if approval.status === 'running' || approvingApprovalId === approval.id}
                    <p role="status" aria-label="Connector action running">Processing connector action…</p>
                  {/if}
                </section>
              {/if}
            {/each}
            {#if message.attachmentIds?.length}
              <div class="message-files">
                {#each message.attachmentIds as fileId}
                  {@const file = state.files.find((candidate) => candidate.id === fileId)}
                  {#if file}<a href={agentScopedUrl(`/api/files/${file.id}/content`)} target="_blank" rel="noreferrer">{file.name}</a>{/if}
                {/each}
              </div>
            {/if}
          </div>
        </article>
      {/each}

    </div>
    {#if !atBottom}
      <button class="new-messages" aria-label="Scroll to bottom" onclick={() => scrollLatest('smooth')}>
        <ArrowDown size={15} aria-hidden="true" />
        {unreadMessages > 0 ? `${unreadMessages} new ${unreadMessages === 1 ? 'message' : 'messages'}` : 'Scroll to bottom'}
      </button>
    {/if}
  </section>

  <footer>
    <form onsubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea aria-label="Message the agent" placeholder={stressMode ? 'UI stress fixture — messages are not sent' : 'Message the agent'} bind:value={draft} onkeydown={keydown} rows="3" disabled={stressMode}></textarea>
      {#if selectedAttachmentIds.length}
        <div class="selected-files">
          {#each selectedAttachmentIds as fileId}
            {@const file = state.files.find((candidate) => candidate.id === fileId)}
            {#if file}<button type="button" onclick={() => (selectedAttachmentIds = selectedAttachmentIds.filter((id) => id !== fileId))}>{file.name} <X size={12} aria-hidden="true" /></button>{/if}
          {/each}
        </div>
      {/if}
      <div class="composer-row">
        <label class="attach-button" aria-label={uploading ? 'Uploading attachments' : 'Attach files'} title={uploading ? 'Uploading attachments' : 'Attach files'}>
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json" onchange={upload} />
          {#if uploading}<LoaderCircle size={19} class="spin" aria-hidden="true" />{:else}<Paperclip size={19} aria-hidden="true" />{/if}
        </label>
        <button class="send-button" aria-label={sendButtonLabel()} title={sendButtonLabel()} aria-busy={sending || threadLoading} disabled={stressMode || !draft.trim() || sending || uploading || threadLoading}>
          {#if sending || threadLoading}<LoaderCircle size={19} class="spin" aria-hidden="true" />{:else}<SendHorizontal size={19} aria-hidden="true" />{/if}
        </button>
      </div>
    </form>
    {#if error}<p class="error">{error}</p>{/if}
  </footer>

  {#if settingsOpen}
    <button class="scrim" aria-label="Close command palette" onclick={() => (settingsOpen = false)}></button>
  {/if}
  <aside class:open={settingsOpen} aria-label="Command palette" aria-hidden={!settingsOpen} onfocusin={() => (editingSettings = true)} onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) editingSettings = false; }}>
    <div class="drawer-header">
      <button class="theme-toggle" aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} appearance`} title={`Use ${theme === 'dark' ? 'light' : 'dark'} appearance`} onclick={toggleTheme}>{#if theme === 'dark'}<Sun size={17} />{:else}<Moon size={17} />{/if}</button>
      <kbd>⌘K</kbd>
      <button class="close" aria-label="Close command palette" title="Close command palette" onclick={() => (settingsOpen = false)}><X size={20} aria-hidden="true" /></button>
    </div>
    <nav class="palette-tabs" aria-label="Command palette sections">
      {#each [['account', 'Account'], ['settings', 'Settings'], ['tools', 'Tools'], ['skills', 'Skills'], ['files', 'Files'], ['state', 'State'], ['jobs', 'Jobs']] as [id, label]}
        <button class:active={paletteTab === id} onclick={() => (paletteTab = id)}>{label}</button>
      {/each}
    </nav>
    <div class="strategy-list">
    {#if paletteTab === 'account'}
    <section class="account" aria-labelledby="account-heading">
      <h3 id="account-heading">Personal</h3>
      <div class="account-row">
        {#if viewer.avatarUrl}
          <div class="avatar"><img src={viewer.avatarUrl} alt={viewer.name} referrerpolicy="no-referrer" /></div>
        {:else}
          <button type="button" class="account-avatar-button" aria-label="Generate a new personal avatar" title="Generate a new personal avatar" onclick={randomizePersonalAvatar}>
            <AgentAvatar hash={personalAvatarSeed || viewer.id} size={32} />
          </button>
        {/if}
        <div>
          <strong>{viewer.name}</strong>
          <span>{viewer.email}</span>
        </div>
      </div>
      {#if connectorState.configured}
        <div class="connector-row">
          <div><strong>{connectorState.name}</strong><span>Personal connector for {viewer.email}</span></div>
          {#if connectorState.connected}
            <button class="quiet" onclick={() => safely(disconnectConnector)}>Disconnect</button>
          {:else}
            <a class="button-link" href="/api/connectors/mcp/authorize?return=/">Connect {connectorState.name}</a>
          {/if}
        </div>
        <p class="empty">This connection belongs only to {viewer.email}. The shared agent may use it only on turns you send.</p>
      {:else}
        <p class="empty">No MCP connector is configured. Set <code>MCP_SERVER_URL</code> on the Worker to let each person connect their own tools.</p>
      {/if}
      <section class="settings-section">
        <h3>Notifications</h3>
        <p class="empty">Agent replies and recurring jobs can notify this device.</p>
        {#if pushEnabled}
          <button class="quiet" onclick={() => safely(disablePush)}>Disable push notifications</button>
        {:else}
          <button disabled={!state.pushPublicKey} onclick={() => safely(enablePush)}>Enable push notifications</button>
        {/if}
      </section>
    </section>
    {/if}
    {#if paletteTab === 'tools'}
      <section class="settings-section">
        <div class="section-heading"><h3>Tools</h3><span>{(state.tools ?? []).length}</span></div>
        <p class="empty">Room tools plus each speaker's own MCP connector. MCP runs only as the person who sent the turn.</p>
        {#each state.tools ?? [] as tool}
          <details class="tool-details">
            <summary><strong>{tool.label}</strong><span>{tool.name}</span></summary>
            <p>{tool.description}</p>
            <dl><div><dt>Scope</dt><dd>{tool.owner === 'room' ? 'Shared room' : 'Personal connector'}</dd></div><div><dt>Access</dt><dd>Available to the agent during an authorized turn</dd></div></dl>
          </details>
        {/each}
      </section>
    {/if}
    {#if paletteTab === 'skills'}
      <section class="settings-section">
        <div class="section-heading"><h3>Skills</h3><span>{(state.skills ?? []).length}</span></div>
        {#if !(state.skills ?? []).length}<p class="empty">No reusable skills yet. Create one here or ask the agent.</p>{/if}
        {#each state.skills ?? [] as skill}
          <details class="managed-details">
            <summary><strong>{skill.name}</strong><span>{skill.description}</span></summary>
            <form class="compact-form" onsubmit={(event) => { event.preventDefault(); safely(() => mutate('PUT', `/api/skills/${encodeURIComponent(skill.name)}`, { description: skill.description, body: skill.body })); }}>
              <input aria-label={`${skill.name} description`} bind:value={skill.description} />
              <textarea aria-label={`${skill.name} instructions`} rows="4" bind:value={skill.body}></textarea>
              <div><button>Save changes</button><button type="button" class="quiet danger" onclick={() => safely(() => mutate('DELETE', `/api/skills/${encodeURIComponent(skill.name)}`))}>Delete</button></div>
            </form>
          </details>
        {/each}
        <form class="compact-form skill-create-form" onsubmit={(event) => { event.preventDefault(); safely(async () => { await mutate('POST', '/api/skills', { name: skillName, description: skillDescription, body: skillBody }); skillName = ''; skillDescription = ''; skillBody = ''; }); }}>
          <input aria-label="Skill name" placeholder="skill-name" bind:value={skillName} />
          <input aria-label="Skill description" placeholder="What this skill is for" bind:value={skillDescription} />
          <textarea aria-label="Skill body" rows="4" placeholder="Instructions the agent should follow" bind:value={skillBody}></textarea>
          <button disabled={savingSettings || !skillName.trim() || !skillDescription.trim() || !skillBody.trim()}>Create skill</button>
        </form>
      </section>
    {/if}
    {#if paletteTab === 'settings'}
      <p class="palette-section">Settings</p>
      <section class="settings-section avatar-settings-section">
        <div class="section-heading"><h3>{threadLens.current.title} settings</h3><span>Only this agent</span></div>
        <div class="avatar-setting">
          <AgentAvatar hash={threadLens.current.avatarSeed || state.settings.agentAvatarSeed} size={44} />
          <div><strong>{threadLens.current.title} icon</strong><span>Choose a generated profile for this agent.</span></div>
          <button type="button" class="quiet" disabled={savingSettings} onclick={randomizeAgentAvatar}>Generate new icon</button>
        </div>
      </section>
      <fieldset>
        <legend>Model</legend>
        <select aria-label="Model" value={state.settings.modelId} disabled={savingSettings} onchange={(event) => saveSetting('modelId', event.currentTarget.value)}>
          {#each state.models as model}
            <option value={model.id}>{model.label}</option>
          {/each}
        </select>
      </fieldset>
      <fieldset>
        <legend>Thinking level</legend>
        <select aria-label="Thinking level" value={state.settings.thinkingLevel} disabled={savingSettings} onchange={(event) => saveSetting('thinkingLevel', event.currentTarget.value)}>
          {#each state.thinkingLevels as level}
            <option value={level.id}>{level.label}</option>
          {/each}
        </select>
      </fieldset>
      <fieldset>
        <legend>Routing</legend>
        <select aria-label="Routing strategy" value={state.settings.strategyId} disabled={savingSettings} onchange={(event) => saveSetting('strategyId', event.currentTarget.value)}>
          {#each state.strategyCategories as category}
            <optgroup label={category}>
              {#each state.strategies.filter((strategy) => strategy.category === category) as strategy}
                <option value={strategy.id}>{strategy.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </fieldset>
      <section class="settings-section context-section">
        <div class="section-heading"><h3>Room history</h3><span>{roomMessageCount()} messages</span></div>
        <p class="empty">Compact the agent’s durable context without deleting room messages. Clearing room history is separate.</p>
        <div class="history-actions">
          <button type="button" class="quiet" disabled={savingSettings} onclick={() => safely(() => mutate('POST', '/api/pi/compact', {}))}>Compact agent context</button>
          <button type="button" class="quiet danger" disabled={savingSettings || roomMessageCount() === 0} onclick={() => safely(() => mutate('POST', '/api/history/clear', {}))}>Clear room history</button>
        </div>
      </section>
      <section class="settings-section">
        <div class="section-heading"><h3>System prompt</h3><span>{systemPromptDraft.length} / 8,000</span></div>
        <p class="empty">Private to {threadLens.current.title}. Active turns keep the prompt they started with.</p>
        <form class="system-prompt" onsubmit={(event) => { event.preventDefault(); saveSetting('systemPrompt', systemPromptDraft); }}>
          <textarea aria-label="System prompt" rows="10" maxlength="8000" bind:value={systemPromptDraft}></textarea>
          <button disabled={savingSettings || !systemPromptDraft.trim() || systemPromptDraft.trim() === state.settings.systemPrompt}>Save system prompt</button>
        </form>
      </section>
    {/if}
    {#if paletteTab === 'files'}
      <section class="settings-section">
        <div class="section-heading"><h3>Files</h3><span>{state.files.length}</span></div>
        {#if state.files.length === 0}<p class="empty">No shared files yet.</p>{/if}
        {#each state.files as file}
          <div class="managed-row">
            <a href={agentScopedUrl(`/api/files/${file.id}/content`)} target="_blank" rel="noreferrer"><strong>{file.name}</strong><span>{file.kind} · {Math.ceil(file.bytes / 1024)} KB</span></a>
            <button class="quiet danger" onclick={() => safely(() => mutate('DELETE', `/api/files/${file.id}`))}>Delete</button>
          </div>
        {/each}
      </section>
    {/if}
    {#if paletteTab === 'state'}
      <section class="settings-section">
        <div class="section-heading"><h3>Agent state</h3><span>{state.agentState.length}</span></div>
        <form class="compact-form" onsubmit={(event) => { event.preventDefault(); safely(createStateEntry); }}>
          <input aria-label="New state key" placeholder="Key" bind:value={stateKey} />
          <textarea aria-label="New state value" placeholder="Value" rows="2" bind:value={stateValue}></textarea>
          <button disabled={!stateKey.trim() || !stateValue.trim()}>Add state</button>
        </form>
        {#each state.agentState as entry}
          <form class="managed-editor" onsubmit={(event) => { event.preventDefault(); safely(() => mutate('PUT', `/api/agent-state/${entry.id}`, { key: entry.key, value: entry.value })); }}>
            <input aria-label="State key" bind:value={entry.key} />
            <textarea aria-label="State value" rows="2" bind:value={entry.value}></textarea>
            <div><button>Save</button><button type="button" class="quiet danger" onclick={() => safely(() => mutate('DELETE', `/api/agent-state/${entry.id}`))}>Delete</button></div>
          </form>
        {/each}
      </section>
    {/if}
    {#if paletteTab === 'jobs'}
      <section class="settings-section">
        <div class="section-heading"><h3>Recurring jobs</h3><span>{state.jobs.length}</span></div>
        <form class="compact-form" onsubmit={(event) => { event.preventDefault(); safely(createJob); }}>
          <input aria-label="New job name" placeholder="Name" bind:value={jobName} />
          <textarea aria-label="New job prompt" placeholder="Prompt" rows="2" bind:value={jobPrompt}></textarea>
          <label class="field-label">Every <input aria-label="New job interval seconds" type="number" min="1" max="2592000" bind:value={jobInterval} /> seconds</label>
          <button disabled={!jobName.trim() || !jobPrompt.trim()}>Create job</button>
        </form>
        {#each state.jobs as job}
          <form class="managed-editor" onsubmit={(event) => { event.preventDefault(); safely(() => mutate('PUT', `/api/jobs/${job.id}`, { name: job.name, prompt: job.prompt, intervalSeconds: Number(job.intervalSeconds), maxRuns: job.maxRuns })); }}>
            <div class="section-heading"><strong>{job.name}</strong><span>{job.status} · {job.runCount} runs</span></div>
            <input aria-label="Job name" bind:value={job.name} />
            <textarea aria-label="Job prompt" rows="2" bind:value={job.prompt}></textarea>
            <label class="field-label">Every <input aria-label="Job interval seconds" type="number" min="1" max="2592000" bind:value={job.intervalSeconds} /> seconds</label>
            <div>
              <button>Save</button>
              {#if job.status === 'active'}<button type="button" class="quiet" onclick={() => safely(() => mutate('POST', `/api/jobs/${job.id}/pause`, {}))}>Pause</button>{/if}
              {#if job.status === 'paused'}<button type="button" class="quiet" onclick={() => safely(() => mutate('POST', `/api/jobs/${job.id}/resume`, {}))}>Resume</button>{/if}
              <button type="button" class="quiet danger" onclick={() => safely(() => mutate('DELETE', `/api/jobs/${job.id}`))}>Delete</button>
            </div>
          </form>
        {/each}
      </section>
    {/if}
    </div>
  </aside>
</main>
{#if treeOpen}<AgentTree nodes={treeNodes} activeId={threadLens.current.id} onOpenConversation={(id) => { treeOpen = false; void openThread(id); }} onClose={() => treeOpen = false} />{/if}
<Modal open={editingAgentName} title={`Rename ${threadLens.current.title}`} bind:value={agentNameDraft} onSave={(value) => renameThread(threadLens.current, value)} onClose={() => editingAgentName = false} />

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) { color-scheme: light; --surface: #fff; --surface-secondary: #f7f7f7; --surface-raised: #ededed; --text: #171717; --text-secondary: #646464; --border: #dedede; --border-strong: #a8a8a8; --surface-overlay: #fff; --overlay-scrim: rgb(15 15 15 / 38%); --overlay-shadow: 0 24px 64px rgb(0 0 0 / 22%), 0 2px 8px rgb(0 0 0 / 10%); --focus: #0055c7; --error: #b42318; }
  :global(:root[data-theme='dark']) { color-scheme: dark; --surface: #101010; --surface-secondary: #181818; --surface-raised: #242424; --text: #f5f5f5; --text-secondary: #a0a0a0; --border: #303030; --border-strong: #707070; --surface-overlay: #262626; --overlay-scrim: rgb(0 0 0 / 68%); --overlay-shadow: 0 28px 80px rgb(0 0 0 / 70%), 0 0 0 1px rgb(255 255 255 / 6%); --focus: #78b7ff; --error: #ff7770; }
  :global(html), :global(body) { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  :global(body) { background: var(--surface); color: var(--text); font: 14px/1.5 Geist, ui-sans-serif, system-ui, sans-serif; }
  :global(button), :global(textarea), :global(select) { font: inherit; }
  main { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; background: var(--surface); }
  .thread-sidebar { position: static; z-index: auto; grid-row: 1 / -1; display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; width: auto; max-height: none; padding: 0.85rem; overflow: auto; border: 0; border-right: 1px solid var(--border); border-radius: 0; background: var(--surface-secondary); transform: none; opacity: 1; pointer-events: auto; }
  .thread-sidebar-heading { display: flex; justify-content: space-between; align-items: center; color: var(--text-secondary); font-size: 12px; }
  .thread-sidebar-heading span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; } .thread-sidebar-heading button, .thread-row, .thread-child { border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
  .thread-sidebar-heading button { display: inline-flex; height: 28px; align-items: center; padding: 0 0.65rem; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 8%); color: var(--text); font-size: 12px; font-weight: 600; } .agent-tree { display: flex; flex-direction: column; gap: 0.2rem; } .thread-row { display: flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.4rem; padding-left: calc(0.4rem + var(--depth) * 1rem); border-radius: 8px; } .thread-row:hover, .thread-selected { background: var(--surface-raised); } .thread-row .thread-status { margin-left: auto; } .thread-delete { display: none; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; } .thread-row:hover .thread-delete { display: block; } .thread-agent { display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font: inherit; } .tree-toggle { width: 1rem; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; } .tree-spacer { width: 1rem; }
  .thread-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.6rem 0.65rem; border-radius: 7px; }
  .thread-row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thread-row:hover, .thread-selected { background: var(--surface-raised); }
  .thread-status { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #9a9a9a; }
  .thread-status[data-status='active'] { background: #c87923; } .thread-status[data-status='complete'] { background: #4d8b65; } .thread-status[data-status='failed'] { background: #bf554d; }
  .thread-child { margin-top: auto; padding: 0.6rem; color: var(--text-secondary); }
  .agent-orchestrator-button { border: 0; background: transparent; cursor: pointer; padding: 0; } .agent-name-title { border: 0; background: transparent; color: var(--text); cursor: text; font: 600 16px/1.2 inherit; padding: 0.35rem 0.5rem; border-radius: 6px; } .agent-name-title:hover { background: var(--surface-raised); } header { display: flex; align-items: center; gap: 0.75rem; min-height: 56px; padding: 0.625rem 1.5rem; border-bottom: 1px solid var(--border); background: var(--surface); }
  .avatar { display: grid; place-items: center; width: 32px; height: 32px; overflow: hidden; border-radius: 50%; color: #fff; font-size: 14px; font-weight: 600; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  h3 { margin: 0; font-size: 15px; font-weight: 600; }
  .presence { display: flex; align-items: center; gap: 0.6rem; margin-left: auto; color: var(--text-secondary); font-size: 14px; }
  .presence-stack { display: flex; flex-direction: row-reverse; justify-content: flex-end; padding-left: 7px; }
  .presence-avatar, .presence-more { display: grid; place-items: center; width: 25px; height: 25px; margin-left: -7px; overflow: hidden; border: 2px solid var(--surface); border-radius: 50%; color: #fff; font-size: 8px; font-weight: 600; }
  .presence-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .presence-avatar :global(svg), .message.user .avatar :global(svg) { border: 0; }
  .presence-more { background: var(--surface-raised); color: var(--text-secondary); font-size: 10px; }
  .presence-label { white-space: nowrap; }
  .stress-badge { margin-left: 0.4rem; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-secondary); padding: 0.25rem 0.55rem; color: var(--text-secondary); font-size: 14px; }
  button { border: 1px solid var(--text); border-radius: 6px; background: var(--text); color: var(--surface); padding: 0.5rem 0.85rem; font-weight: 600; cursor: pointer; }
  button:disabled { cursor: default; opacity: 0.45; }
  .settings-button { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.65rem; border-color: var(--border); background: var(--surface-secondary); color: var(--text); }
  :global(.settings-button svg) { stroke-width: 1.7; }
  kbd { border: 1px solid var(--border); border-radius: 4px; padding: 0.05rem 0.25rem; color: var(--text-secondary); font: 0.9em/1 "Geist Mono", ui-monospace, monospace; }
  .feed { min-height: 0; overflow-y: auto; background: var(--surface); }
  .conversation { width: min(760px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 5rem; }
  .agent-empty-state { display: grid; justify-items: center; gap: 0.65rem; max-width: 28rem; margin: 14vh auto 0; padding: 2rem; text-align: center; color: var(--text-secondary); } .agent-empty-state h2 { margin: 0; color: var(--text); font-size: 1.15rem; } .agent-empty-state p { margin: 0; } .agent-empty-state button { margin-top: 0.35rem; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0.6rem 0.9rem; font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgb(0 0 0 / 8%); } .agent-empty-state button:hover { background: var(--surface-raised); }
  .message { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 0.75rem; padding: 0.9rem 0; }
  .body { min-width: 0; }
  .meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.5rem; min-height: 21px; }
  .author-email { color: var(--text-secondary); font-size: 14px; }
  .stop-button { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border-color: var(--error); background: var(--surface); color: var(--error); border-radius: 999px; }
  .stop-button:hover { background: var(--error); color: var(--surface); }
  .meta strong { font-weight: 600; }
  time { color: var(--text-secondary); font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.8em; }
  .body p { margin: 0.2rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .markdown { min-width: 0; margin-top: 0.35rem; overflow-wrap: anywhere; }
  .markdown :global(:first-child) { margin-top: 0; }
  .markdown :global(:last-child) { margin-bottom: 0; }
  .markdown :global(p), .markdown :global(ul), .markdown :global(ol), .markdown :global(blockquote), .markdown :global(pre), .markdown :global(table) { margin: 0.65rem 0; }
  .markdown :global(ul), .markdown :global(ol) { padding-left: 1.4rem; }
  .markdown :global(blockquote) { margin-left: 0; padding-left: 0.8rem; border-left: 3px solid var(--border-strong); color: var(--text-secondary); }
  .markdown :global(code) { border-radius: 4px; background: var(--surface-raised); padding: 0.1rem 0.3rem; font: 0.88em/1.5 "Geist Mono", ui-monospace, monospace; }
  .markdown :global(pre) { max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-secondary); padding: 0.8rem; }
  .markdown :global(pre code) { background: transparent; padding: 0; }
  .markdown :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
  .markdown :global(th), .markdown :global(td) { border: 1px solid var(--border); padding: 0.4rem 0.55rem; text-align: left; }
  .markdown :global(a) { color: var(--focus); }
  .reasoning { margin-top: 0.4rem; color: var(--text-secondary); font-size: 14px; }
  .reasoning summary { display: flex; align-items: center; gap: 0.4rem; width: fit-content; cursor: pointer; font-weight: 600; }
  .reasoning > div { max-height: 180px; margin-top: 0.35rem; overflow: auto; border-left: 2px solid var(--border); padding-left: 0.7rem; white-space: pre-wrap; }
  .tool-activity { display: grid; gap: 0.3rem; margin-top: 0.55rem; }
  .tool-activity > details { color: var(--text-secondary); font: 0.9em/1.4 "Geist Mono", ui-monospace, monospace; }
  .tool-activity summary { display: grid; grid-template-columns: 14px minmax(0, auto) 1fr; align-items: center; gap: 0.4rem; cursor: pointer; list-style: none; }
  .tool-activity summary::-webkit-details-marker { display: none; }
  .tool-target { opacity: 0.75; }
  .tool-detail { margin: 0.3rem 0 0.4rem 1.2rem; border-left: 2px solid var(--border); padding-left: 0.7rem; }
  .tool-label { margin-top: 0.3rem; font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .tool-detail pre { max-height: 260px; margin: 0.2rem 0 0; overflow: auto; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 0.9em; }
  .tool-activity time { justify-self: end; }
  .tool-dot { width: 6px; height: 6px; margin-left: 4px; border-radius: 50%; background: currentColor; }
  .error-tool { color: var(--error) !important; }
  .thinking { display: flex; align-items: center; gap: 0.3rem; min-height: 30px; }
  .thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); animation: pulse 1.2s ease-in-out infinite; }
  .thinking span:nth-child(2) { animation-delay: 140ms; }
  .thinking span:nth-child(3) { animation-delay: 280ms; }
  .user { grid-template-columns: minmax(0, 1fr) 32px; width: min(78%, 640px); margin-left: auto; }
  .user .avatar { grid-column: 2; grid-row: 1; }
  .user .body { grid-column: 1; grid-row: 1; display: grid; justify-items: end; }
  .user .meta { justify-content: flex-end; }
  .user .body p { border: 1px solid var(--border); border-radius: 8px; background: var(--surface-secondary); padding: 0.7rem 1rem; }
  .welcome { padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem; }
  .pending { opacity: 0.65; }
  .response-indicator { display: inline-grid; width: 18px; height: 18px; place-items: center; color: var(--text-secondary); }
  .state { color: var(--text-secondary); font-size: 14px; }
  .error-state, .error { color: var(--error); }
  .reply { color: var(--text-secondary); font-size: 14px; }
  footer { border-top: 1px solid var(--border); background: var(--surface); padding: 0.875rem 1rem; }
  footer > form { width: min(760px, 100%); margin: 0 auto; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface); }
  textarea { display: block; width: 100%; resize: none; border: 0; outline: 0; background: transparent; padding: 0.85rem 1rem 0.25rem; color: var(--text); }
  textarea::placeholder { color: var(--text-secondary); }
  .composer-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.4rem 0.65rem 0.6rem; }
  .attach-button, .send-button { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; border-radius: 8px; }
  .attach-button { cursor: pointer; color: var(--text-secondary); }
  .attach-button:hover { background: var(--surface-raised); color: var(--text); }
  .attach-button input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  :global(.spin) { animation: spin 900ms linear infinite; }
  .selected-files, .message-files { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.35rem 0.75rem; }
  .selected-files button, .message-files a { display: inline-flex; align-items: center; gap: 0.25rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-secondary); color: var(--text); padding: 0.3rem 0.5rem; font-size: 14px; text-decoration: none; }
  .message-files { justify-content: flex-end; padding-inline: 0; }
  .assistant .message-files { justify-content: flex-start; }
  .new-messages { position: sticky; left: 50%; bottom: 1rem; z-index: 2; display: inline-flex; align-items: center; gap: 0.35rem; transform: translateX(-50%); }
  button:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .error { width: min(760px, 100%); margin: 0.4rem auto 0; font-size: 14px; }
  .scrim { position: fixed; inset: 0; z-index: 4; margin: 0; padding: 0; border: 0; border-radius: 0; outline: 0; background: var(--overlay-scrim); backdrop-filter: blur(3px); cursor: default; }
  .scrim:focus-visible { outline: 0; }
  aside { position: fixed; top: 8vh; right: 50%; bottom: auto; z-index: 5; display: grid; grid-template-rows: auto auto minmax(0, 1fr); width: min(720px, 94vw); max-height: 84vh; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-overlay); box-shadow: var(--overlay-shadow); transform: translate(50%, 0); opacity: 0; pointer-events: none; }
  aside.open { opacity: 1; pointer-events: auto; }
  .drawer-header { display: flex; align-items: center; justify-content: flex-end; gap: 0.55rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); }
  .theme-toggle, .close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 32px; height: 32px; border: 0; background: transparent; color: var(--text-secondary); padding: 0; }
  .theme-toggle { margin-left: auto; }
  .theme-toggle:hover, .close:hover { background: var(--surface-raised); color: var(--text); }
  .close { font-size: 24px; line-height: 1; }
  .palette-tabs { display: flex; justify-content: flex-end; gap: 0.35rem; overflow-x: auto; padding: 0.65rem 1rem; }
  .palette-tabs button { border: 0; background: transparent; color: var(--text-secondary); padding: 0.45rem 0.65rem; font-size: 14px; }
  .palette-tabs button.active { background: var(--surface-raised); color: var(--text); }
  .account { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
  .account h3 { margin-bottom: 0.75rem; }
  .account-row { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 0.75rem; align-items: center; }
  .account-row > div:last-child { display: grid; min-width: 0; }
  .account-avatar-button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; padding: 0; }
  .account-avatar-button:focus-visible { border-radius: 50%; }
  .account-row strong, .account-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .account-row span { color: var(--text-secondary); font-size: 14px; }
  .strategy-list { overflow-y: auto; padding: 0.75rem 1rem 1rem; }
  .palette-section { margin: 1rem 0 0.25rem; color: var(--text-secondary); font-size: 14px; font-weight: 600; }
  .history-actions, .approval-actions { display: flex; gap: 0.5rem; margin-top: 0.65rem; }
  fieldset { margin: 0; padding: 0.5rem 0; border: 0; }
  legend { padding: 0; color: var(--text-secondary); font-size: 14px; font-weight: 600; }
  select, input { width: 100%; margin-top: 0.35rem; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); padding: 0.65rem 0.75rem; color: var(--text); }
  .settings-section { margin-top: 1rem; padding-top: 1rem; }
  .avatar-settings-section { margin-top: 0; padding-top: 0.5rem; }
  .avatar-setting { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 0.75rem; align-items: center; padding: 0.75rem 0; }
  .avatar-setting > div { display: grid; gap: 0.15rem; min-width: 0; }
  .avatar-setting span { color: var(--text-secondary); }
  .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
  .section-heading span, .empty, .field-label { color: var(--text-secondary); font-size: 14px; }
  .empty { margin: 0.4rem 0; }
  .managed-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; padding: 0.55rem 0; }
  .tool-details, .managed-details { padding: 0.65rem 0; border-bottom: 1px solid var(--border); }
  .tool-details summary, .managed-details summary { display: grid; grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr); gap: 0.75rem; align-items: start; cursor: pointer; list-style: none; }
  .tool-details summary strong, .managed-details summary strong { min-width: 0; overflow-wrap: anywhere; }
  .tool-details summary::-webkit-details-marker, .managed-details summary::-webkit-details-marker { display: none; }
  .tool-details summary span, .managed-details summary span, .tool-details p, .tool-details dt { min-width: 0; color: var(--text-secondary); font-size: 14px; overflow-wrap: anywhere; }
  .tool-details p { margin: 0.5rem 0; }
  .tool-details dl { display: grid; gap: 0.25rem; margin: 0; }
  .tool-details dl div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 0.5rem; }
  .tool-details dt, .tool-details dd { margin: 0; }
  .tool-details dd { font-size: 14px; }
  .connector-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.75rem; align-items: center; padding-top: 0.75rem; }
  .connector-row > div { display: grid; }
  .connector-row span { color: var(--text-secondary); font-size: 14px; }
  .button-link { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--text); border-radius: 6px; background: var(--text); color: var(--surface); padding: 0.5rem 0.85rem; font-weight: 600; text-decoration: none; }
  .managed-row a, .managed-row a span { display: grid; min-width: 0; overflow: hidden; color: var(--text); text-overflow: ellipsis; text-decoration: none; white-space: nowrap; }
  .managed-row a span { color: var(--text-secondary); font-size: 14px; }
  .compact-form, .managed-editor, .system-prompt { display: grid; gap: 0.5rem; margin-top: 0.65rem; padding: 0.65rem 0; }
  .managed-editor { border-top: 1px solid var(--border); }
  .compact-form textarea, .managed-editor textarea, .system-prompt textarea { border: 1px solid var(--border-strong); border-radius: 6px; padding: 0.65rem 0.75rem; }
  .skill-create-form textarea { min-height: 120px; }
  .system-prompt textarea { min-height: 180px; resize: vertical; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.9em; line-height: 1.55; }
  .managed-editor > div:last-child { display: flex; gap: 0.4rem; }
  .field-label { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.4rem; align-items: center; }
  .field-label input { margin: 0; }
  .quiet { border-color: var(--border); background: transparent; color: var(--text); }
  .danger { color: var(--error); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
  @media (prefers-color-scheme: dark) { :global(:root) { --surface: #101010; --surface-secondary: #181818; --surface-raised: #242424; --text: #f5f5f5; --text-secondary: #a0a0a0; --border: #303030; --border-strong: #707070; --focus: #78b7ff; --error: #ff7770; } }
  @media (max-width: 640px) { header { padding-inline: 1rem; } .presence-label, .stress-badge { display: none; } .conversation { padding-bottom: 2rem; } .user { width: 90%; } .avatar-setting { grid-template-columns: 44px minmax(0, 1fr); } .avatar-setting button { grid-column: 1 / -1; } textarea, input, select { font-size: 16px; } }
  @media (prefers-reduced-motion: reduce) { aside { transition: none; } .thinking span, :global(.spin) { animation: none; } }
</style>
