import {
  Container,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  type TUI,
} from '@yaseenhq/pi-tui';

import { FooterComponent } from './components/chrome/footer';
import { GutterContainer } from './components/chrome/gutter-container';
import type { MoonLoader } from './components/chrome/moon-loader';
import { TodoPanelComponent } from './components/chrome/todo-panel';
import type { SessionRow } from './components/dialogs/session-picker';
import { CustomEditor } from './components/editor/custom-editor';
import { DEFAULT_TUI_CONFIG } from './config';
import { CHROME_GUTTER } from './constant/rendering';
import type { TasksBrowserState } from './controllers/tasks-browser';
import { currentTheme, type Theme } from './theme';
import { createTerminalState, type TerminalState } from './utils/terminal-state';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type KimiTUIOptions,
  type LivePaneState,
  type QueuedMessage,
  type TranscriptEntry,
  type TUIStartupState,
} from './types';

/** Keeps height deficit on the transcript; see the root-stack comment. */
const DOCK_SHRINK_WEIGHT = 0.001;

export interface TUIState {
  ui: TUI;
  terminal: ProcessTerminal;
  transcriptContainer: Container;
  activityContainer: Container;
  todoPanelContainer: Container;
  todoPanel: TodoPanelComponent;
  queueContainer: Container;
  btwPanelContainer: Container;
  editorContainer: Container;
  footer: FooterComponent;
  editor: CustomEditor;
  theme: Theme;
  appState: AppState;
  startupState: TUIStartupState;
  livePane: LivePaneState;
  transcriptEntries: TranscriptEntry[];
  terminalState: TerminalState;
  activitySpinner: MoonLoader | null;
  toolOutputExpanded: boolean;
  sessions: SessionRow[];
  loadingSessions: boolean;
  sessionsScope: 'cwd' | 'all';
  activeDialog: 'session-picker' | 'help' | 'cache-hint' | null;
  tasksBrowser: TasksBrowserState | undefined;
  externalEditorRunning: boolean;
  queuedMessages: QueuedMessage[];
  /**
   * True while a queued user message has been shifted out of
   * {@link queuedMessages} but its deferred send has not run yet. The queue
   * looks empty during this window, so queued-goal promotion must also check
   * this flag to avoid starting a goal ahead of the user's earlier message.
   */
  queuedMessageDispatchPending: boolean;
  swarmModeEntry: 'manual' | 'task' | undefined;
  /**
   * Fullscreen only: the bottom dock (activity / todo / queue / btw / editor)
   * stacked under the transcript ScrollView. Undefined in regular mode, where
   * every piece of chrome is a direct child of the root container.
   */
  dockContainer: VStack | undefined;
}

export function createTUIState(options: KimiTUIOptions): TUIState {
  const initialAppState = options.initialAppState;
  const theme = currentTheme;

  const terminal = new ProcessTerminal();
  // Fullscreen is experimental and env-gated: ECHADRON_TUI_FULL_SCREEN=1.
  // The alternate screen scrolls the transcript inside a primary ScrollView
  // and docks the rest of the chrome at the bottom, instead of letting the
  // whole UI flow through the terminal's own scrollback.
  // `[tui] tui_mode` is the setting; the env override stays for one-off runs
  // and for trying the mode without touching tui.toml.
  const envOverride =
    process.env['ECHADRON_TUI_FULL_SCREEN'] ?? process.env['KIMI_CODE_TUI_FULL_SCREEN'];
  const fullscreen =
    envOverride === undefined
      ? initialAppState.tuiMode === 'fullscreen'
      : envOverride === '1';
  const ui: TUI = fullscreen ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);

  const transcriptContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const activityContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanel = new TodoPanelComponent();
  const queueContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const btwPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editorContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editor = new CustomEditor(ui, {
    disablePasteBurst: initialAppState.disablePasteBurst ?? DEFAULT_TUI_CONFIG.disablePasteBurst,
  });
  const footer = new FooterComponent({ ...initialAppState }, () => {
    ui.requestRender();
  });

  let dockContainer: VStack | undefined;
  if (ui instanceof TuiAltScreen) {
    // The transcript scrolls inside the primary ScrollView; everything else
    // stays docked at the bottom. Sizing mirrors pi's interactive layout: the
    // transcript starts from basis 0 and grows, while the dock keeps its
    // intrinsic height and the editor is never squeezed below its three rows
    // (top border / input / bottom border) or its outline gets clipped.
    const scrollView = new ScrollView(transcriptContainer, {
      follow: 'end',
      primary: true,
      overscroll: 'chain',
      scrollbar: 'auto',
    });
    dockContainer = new VStack();
    dockContainer.addChild(activityContainer, { shrink: 1, minSize: 0 });
    dockContainer.addChild(todoPanelContainer, { shrink: 1, minSize: 0 });
    dockContainer.addChild(queueContainer, { shrink: 1, minSize: 0 });
    dockContainer.addChild(btwPanelContainer, { shrink: 1, minSize: 0 });
    dockContainer.addChild(editorContainer, { shrink: 1, minSize: 3 });
    const root = new VStack();
    // The spacer bottom-anchors an underfilled transcript: on a short session
    // the conversation sits just above the editor instead of stranding at the
    // top of the screen with a dead void between it and the dock. Once the
    // transcript outgrows the viewport the spacer collapses to zero and the
    // ScrollView absorbs the whole height deficit — its shrink weight dwarfs
    // the dock's, so shrink pressure can never crush the activity and todo
    // rows the way an evenly weighted stack would.
    const spacer = new Container();
    root.addChild(spacer, { basis: 0, grow: 1, shrink: 1, minSize: 0 });
    root.addChild(scrollView, { basis: 'auto', grow: 0, shrink: 1, minSize: 1 });
    root.addChild(dockContainer, {
      basis: 'auto',
      grow: 0,
      shrink: DOCK_SHRINK_WEIGHT,
      minSize: 1,
    });
    ui.setLayoutRoot(root);
  }

  return {
    ui,
    dockContainer,
    terminal,
    transcriptContainer,
    activityContainer,
    todoPanelContainer,
    todoPanel,
    queueContainer,
    btwPanelContainer,
    editorContainer,
    editor,
    footer,
    theme,
    appState: { ...initialAppState },
    startupState: 'pending',
    livePane: { ...INITIAL_LIVE_PANE },
    transcriptEntries: [],
    terminalState: createTerminalState(),
    activitySpinner: null,
    toolOutputExpanded: false,
    sessions: [],
    loadingSessions: false,
    sessionsScope: 'cwd',
    activeDialog: null,
    tasksBrowser: undefined,
    externalEditorRunning: false,
    queuedMessages: [],
    queuedMessageDispatchPending: false,
    swarmModeEntry: undefined,
  };
}
