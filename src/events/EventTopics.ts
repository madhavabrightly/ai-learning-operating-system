export const EventTopics = {
  UPLOAD_STARTED: 'upload.started',
  UPLOAD_COMPLETED: 'upload.completed',
  UPLOAD_FAILED: 'upload.failed',

  DOCUMENT_OPENED: 'document.opened',
  DOCUMENT_CLOSED: 'document.closed',
  DOCUMENT_SELECTED_TEXT_CHANGED: 'document.selected_text_changed',
  DOCUMENT_SCROLL_CHANGED: 'document.scroll_changed',

  PROCESS_STARTED: 'process.started',
  PROCESS_COMPLETED: 'process.completed',
  PROCESS_FAILED: 'process.failed',
  PROCESS_STAGE_CHANGED: 'process.stage_changed',

  SUMMARY_READY: 'summary.ready',
  QUIZ_READY: 'quiz.ready',
  GRAPH_READY: 'graph.ready',
  REVISION_READY: 'revision.ready',
  NOTES_UPDATED: 'notes.updated',

  SESSION_RESTORED: 'session.restored',
  SESSION_SAVED: 'session.saved',
  SESSION_SAVE_REQUESTED: 'session.save_requested',

  NOTIFICATION_PUBLISHED: 'notification.published',
  NOTIFICATION_DISMISSED: 'notification.dismissed',
  UI_STATE_CHANGED: 'ui.state_changed',

  WORKSPACE_TAB_OPENED: 'workspace.tab_opened',
  WORKSPACE_TAB_CLOSED: 'workspace.tab_closed',
  WORKSPACE_LAYOUT_CHANGED: 'workspace.layout_changed',

  SOCKET_CONNECTED: 'socket.connected',
  SOCKET_DISCONNECTED: 'socket.disconnected',
  SOCKET_PROGRESS: 'socket.progress',
  SOCKET_RECONNECTING: 'socket.reconnecting',
  SOCKET_MESSAGE_FAILED: 'socket.message_failed',
  SOCKET_AUTH_FAILED: 'socket.auth_failed',

  DOCUMENT_PROFILED: 'document.profiled',
  DOCUMENT_PARSING: 'document.parsing',
  DOCUMENT_LAYOUT_ANALYZED: 'document.layout_analyzed',
  DOCUMENT_OCR_COMPLETED: 'document.ocr_completed',
  DOCUMENT_FORMULAS_EXTRACTED: 'document.formulas_extracted',
  DOCUMENT_TABLES_EXTRACTED: 'document.tables_extracted',
  DOCUMENT_FIGURES_EXTRACTED: 'document.figures_extracted',
  DOCUMENT_KNOWLEDGE_EXTRACTED: 'document.knowledge_extracted',
  DOCUMENT_VALIDATED: 'document.validated',
  DOCUMENT_PAGE_CHANGED: 'document.page_changed',
  DOCUMENT_ZOOM_CHANGED: 'document.zoom_changed',
  DOCUMENT_SEARCH: 'document.search',

  TASK_QUEUED: 'task.queued',
  TASK_RUNNING: 'task.running',
  TASK_RETRYING: 'task.retrying',
  TASK_FALLBACK: 'task.fallback',
  TASK_PROGRESS: 'task.progress',
  TASK_WARNING: 'task.warning',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',

  CONCEPT_SELECTED: 'concept.selected',
  CONCEPTS_EXTRACTED: 'concepts.extracted',

  ASSISTANT_REQUESTED: 'assistant.requested',
  ASSISTANT_RESPONSE: 'assistant.response',

  NOTE_CREATED: 'note.created',
  NOTE_UPDATED: 'note.updated',
  NOTE_DELETED: 'note.deleted',

  OFFLINE_STATE_CHANGED: 'offline.state_changed',

  DEVELOPER_MODE_TOGGLED: 'developer_mode.toggled',
  FEATURE_FLAG_CHANGED: 'feature_flag.changed',
  APP_ERROR: 'app.error',
} as const;

export type EventTopic = (typeof EventTopics)[keyof typeof EventTopics];
