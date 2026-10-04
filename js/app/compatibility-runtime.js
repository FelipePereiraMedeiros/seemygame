import { 
  PEER_CONFIG, 
  getPeerConfig,
  fetchIceServersFromApi,
  QUALITY_PROFILES, 
  DEFAULT_PROFILE, 
  DEFAULT_BITRATE_BPS,
  MAX_VIEWERS_DEFAULT,
  ROOM_MODES,
  TERMS_VERSION,
  getPendingIceServersPromise
} from ".././config.js";
import { 
  hookPeerConnectionSdp, 
  applyTransceiverOptimizations, 
  applySenderOptimizations,
  swapStreamAudioTrack
} from ".././webrtc.js";
import { initAudioAnalyser, stopAudioAnalyser, applyMicrophoneProcessing } from ".././audio.js";
import { startStatsMonitor, stopStatsMonitor, getLastMetrics } from ".././stats.js";
import { 
  showToast, 
  initTermsModal, 
  createPlaceholderCard, 
  updateCardStatus, 
  hideCardLoading, 
  setCardStreamPaused,
  removeVideoCard, 
  addOrUpdateVideoCard,
  showCoopPromptModal,
  updateCoopUI,
  isValidPeerId
} from ".././ui.js";
import {
  handleHostCoopMessage,
  handleViewerCoopMessage,
  requestCoopControl,
  releaseCoopControl,
  revokePlayer2,
  setCoopEnabled,
  setMaxCoopPlayers,
  setPartyModeEnabled,
  getCoopState,
  registerCoopPromptHandler,
  registerCoopStateChangeHandler,
  initCompanionAgentConnection,
  setupGamepadTesterModal
} from ".././coop.js";
import {
  isDesktopApp,
  getCapturableWindows,
  getCapturableSources,
  getNativeCaptureCapabilities,
  getAudioExclusionCandidates,
  setHighPriority,
  createNativeViewerPeer,
  addNativeViewerIceCandidate,
  closeNativeViewerPeer,
  listenNativeCaptureBridge
} from ".././desktop.js";
import { NativeCaptureProvider } from ".././capture.js";
import { requestBrowserDisplayMedia } from ".././browser-capture.js";
import { chatManager } from ".././chat.js";
import { voiceManager } from ".././voice.js";
import { DiscordUIController } from ".././discord-ui.js";
import {
  getAudioDevices,
  populateDeviceSelect,
  playTestTone,
  watchDeviceChanges,
  getSavedAudioPreferences,
  saveAudioPreference,
  isAudioOutputSupported
} from ".././audio-devices.js";
import { clipRecorder } from ".././clipping.js";
import { tacticalPingManager } from ".././ping.js";
import { floatingReactionsManager } from ".././reactions.js";
import { soundboardManager } from ".././soundboard.js";
import { adaptiveBitrateController } from ".././abr.js";
import {
  AUDIO_MEME_EFFECTS,
  getAudioContext,
  decodeAudioFromBlob,
  trimAudioBuffer,
  applyMemeEffect,
  audioBufferToWavBlob,
  wavBlobToBase64,
  base64ToWavBlob,
  playAudioBuffer
} from ".././audio-meme.js";
import { whiteboardManager, WHITEBOARD_TOOLS, WHITEBOARD_COLORS, getPeerCursorColor, processImageFile } from ".././whiteboard.js";

import { RoomManager, sanitizeRoomId, getRoomMasterPeerId } from ".././room.js";
import { RelayManager, DEFAULT_MAX_DIRECT_VIEWERS } from ".././relay.js";
import { EventBus, globalBus } from ".././core/event-bus.js";
import { MessageDispatcher, globalDispatcher } from ".././core/message-dispatcher.js";
import { PluginManager, globalPluginManager } from ".././core/plugin-manager.js";
import { audioContextPool, getSharedAudioContext } from ".././core/audio-context-pool.js";
import {
  BasePlugin,
  WhiteboardPlugin,
  whiteboardPlugin,
  SoundboardPlugin,
  soundboardPlugin,
  TacticalPingPlugin,
  tacticalPingPlugin,
  ReactionsPlugin,
  reactionsPlugin,
  ClippingPlugin,
  clippingPlugin
} from ".././plugins/index.js";
import {
  initViewerApp,
  initStreamerApp,
  initRoomApp,
  initLobbyApp
} from ".././entries/index.js";
import { setTreeRelayEnabled as setTreeRelayEnabledImpl, isRoomMode as isRoomModeImpl, getRoomInfoFromUrl as getRoomInfoFromUrlImpl, getCustomStreamerId as getCustomStreamerIdImpl, setCustomStreamerId as setCustomStreamerIdImpl, getStoredRoomPin as getStoredRoomPinImpl, setStoredRoomPin as setStoredRoomPinImpl, getClientSessionId as getClientSessionIdImpl, isCurrentlyStreaming as isCurrentlyStreamingImpl, getLocalUserDisplayName as getLocalUserDisplayNameImpl, isPeerAuthorizedForMedia as isPeerAuthorizedForMediaImpl, promptViewerPin as promptViewerPinImpl, hideViewerPinModal as hideViewerPinModalImpl, submitViewerPin as submitViewerPinImpl, updateViewerCountUI as updateViewerCountUIImpl, applyCoopModeChange as applyCoopModeChangeImpl } from './session-identity.js';
import { syncClipDurationUI as syncClipDurationUIImpl, syncH264EncoderVisibility as syncH264EncoderVisibilityImpl, syncMediaControlsEnvironment as syncMediaControlsEnvironmentImpl, queueNativeReconfigure as queueNativeReconfigureImpl, applyLiveBitrateChange as applyLiveBitrateChangeImpl, syncAudioModeCapabilities as syncAudioModeCapabilitiesImpl, syncAudioExclusionOptions as syncAudioExclusionOptionsImpl, getSelectedAudioExclusionApp as getSelectedAudioExclusionAppImpl, handleAudioExcludeChange as handleAudioExcludeChangeImpl } from './media-controls.js';
import { getCustomIdRetryAttempts as getCustomIdRetryAttemptsImpl, setCustomIdRetryAttempts as setCustomIdRetryAttemptsImpl, setConfirmedReload as setConfirmedReloadImpl, handlePageUnload as handlePageUnloadImpl, isReloadConfirmationPending as isReloadConfirmationPendingImpl, showReloadConfirmationModal as showReloadConfirmationModalImpl, hideReloadConfirmationModal as hideReloadConfirmationModalImpl, handleReloadKeypress as handleReloadKeypressImpl, resetPeer as resetPeerImpl } from './session-lifecycle.js';
import { setupRoomSession as setupRoomSessionImpl, initPeer as initPeerImpl, broadcastDataMessage as broadcastDataMessageImpl, setupVoiceMediaCall as setupVoiceMediaCallImpl, handleIncomingVoiceCall as handleIncomingVoiceCallImpl } from './peer-session.js';
import { isDuplicateMessage as isDuplicateMessageImpl, initPlugins as initPluginsImpl, handleIncomingP2PMessage as handleIncomingP2PMessageImpl, setupIncomingDataConnection as setupIncomingDataConnectionImpl } from './message-routing.js';
import { initTuningAudioDeviceControls as initTuningAudioDeviceControlsImpl, initDiscordFeatures as initDiscordFeaturesImpl } from './tuning-controller.js';
import { waitForDirectIceGathering as waitForDirectIceGatheringImpl, handleStartDirectStream as handleStartDirectStreamImpl, handleDirectStreamOffer as handleDirectStreamOfferImpl, handleDirectStreamAnswer as handleDirectStreamAnswerImpl, handleDirectStreamIceCandidate as handleDirectStreamIceCandidateImpl, handleDirectStreamSignaling as handleDirectStreamSignalingImpl, setupNativeBridgeListener as setupNativeBridgeListenerImpl } from './native-signaling.js';
import { initiateMediaCallToViewer as initiateMediaCallToViewerImpl, handleIncomingMediaCall as handleIncomingMediaCallImpl } from './media-calls.js';
import { watchFriend as watchFriendImpl, disconnectHost as disconnectHostImpl } from './subscriptions.js';
import { startLocalStream as startLocalStreamImpl, stopLocalStream as stopLocalStreamImpl, initDesktopSupport as initDesktopSupportImpl } from './capture-session.js';
import { handleStreamBtnClick as handleStreamBtnClickImpl, checkAutoWatchUrl as checkAutoWatchUrlImpl, initFixedIdAndPinControls as initFixedIdAndPinControlsImpl } from './identity-controls.js';
import { toggleFacecam as toggleFacecamImpl, initTacticalPing as initTacticalPingImpl, initFloatingReactions as initFloatingReactionsImpl, initAdaptiveBitrate as initAdaptiveBitrateImpl, initFacecam as initFacecamImpl } from './gamer-features.js';
import { closeClipPostModal as closeClipPostModalImpl, openClipPostModal as openClipPostModalImpl } from './clip-editor.js';
import { initWhiteboard as initWhiteboardImpl } from './whiteboard-controller.js';
import { initGamerFeatures as initGamerFeaturesImpl, initAppDom as initAppDomImpl, initGamerKeybindings as initGamerKeybindingsImpl } from './page-controller.js';
import { initGreenRoomLobby as initGreenRoomLobbyImpl } from './green-room.js';
const compatibilityPorts = Object.defineProperties({}, {
"PEER_CONFIG": { get: () => PEER_CONFIG },
"getPeerConfig": { get: () => getPeerConfig },
"fetchIceServersFromApi": { get: () => fetchIceServersFromApi },
"QUALITY_PROFILES": { get: () => QUALITY_PROFILES },
"DEFAULT_PROFILE": { get: () => DEFAULT_PROFILE },
"DEFAULT_BITRATE_BPS": { get: () => DEFAULT_BITRATE_BPS },
"MAX_VIEWERS_DEFAULT": { get: () => MAX_VIEWERS_DEFAULT },
"ROOM_MODES": { get: () => ROOM_MODES },
"TERMS_VERSION": { get: () => TERMS_VERSION },
"getPendingIceServersPromise": { get: () => getPendingIceServersPromise },
"hookPeerConnectionSdp": { get: () => hookPeerConnectionSdp },
"applyTransceiverOptimizations": { get: () => applyTransceiverOptimizations },
"applySenderOptimizations": { get: () => applySenderOptimizations },
"swapStreamAudioTrack": { get: () => swapStreamAudioTrack },
"initAudioAnalyser": { get: () => initAudioAnalyser },
"stopAudioAnalyser": { get: () => stopAudioAnalyser },
"applyMicrophoneProcessing": { get: () => applyMicrophoneProcessing },
"startStatsMonitor": { get: () => startStatsMonitor },
"stopStatsMonitor": { get: () => stopStatsMonitor },
"getLastMetrics": { get: () => getLastMetrics },
"showToast": { get: () => showToast },
"initTermsModal": { get: () => initTermsModal },
"createPlaceholderCard": { get: () => createPlaceholderCard },
"updateCardStatus": { get: () => updateCardStatus },
"hideCardLoading": { get: () => hideCardLoading },
"setCardStreamPaused": { get: () => setCardStreamPaused },
"removeVideoCard": { get: () => removeVideoCard },
"addOrUpdateVideoCard": { get: () => addOrUpdateVideoCard },
"showCoopPromptModal": { get: () => showCoopPromptModal },
"updateCoopUI": { get: () => updateCoopUI },
"isValidPeerId": { get: () => isValidPeerId },
"handleHostCoopMessage": { get: () => handleHostCoopMessage },
"handleViewerCoopMessage": { get: () => handleViewerCoopMessage },
"requestCoopControl": { get: () => requestCoopControl },
"releaseCoopControl": { get: () => releaseCoopControl },
"revokePlayer2": { get: () => revokePlayer2 },
"setCoopEnabled": { get: () => setCoopEnabled },
"setMaxCoopPlayers": { get: () => setMaxCoopPlayers },
"setPartyModeEnabled": { get: () => setPartyModeEnabled },
"getCoopState": { get: () => getCoopState },
"registerCoopPromptHandler": { get: () => registerCoopPromptHandler },
"registerCoopStateChangeHandler": { get: () => registerCoopStateChangeHandler },
"initCompanionAgentConnection": { get: () => initCompanionAgentConnection },
"setupGamepadTesterModal": { get: () => setupGamepadTesterModal },
"isDesktopApp": { get: () => isDesktopApp },
"getCapturableWindows": { get: () => getCapturableWindows },
"getCapturableSources": { get: () => getCapturableSources },
"getNativeCaptureCapabilities": { get: () => getNativeCaptureCapabilities },
"getAudioExclusionCandidates": { get: () => getAudioExclusionCandidates },
"setHighPriority": { get: () => setHighPriority },
"createNativeViewerPeer": { get: () => createNativeViewerPeer },
"addNativeViewerIceCandidate": { get: () => addNativeViewerIceCandidate },
"closeNativeViewerPeer": { get: () => closeNativeViewerPeer },
"listenNativeCaptureBridge": { get: () => listenNativeCaptureBridge },
"NativeCaptureProvider": { get: () => NativeCaptureProvider },
"requestBrowserDisplayMedia": { get: () => requestBrowserDisplayMedia },
"chatManager": { get: () => chatManager },
"voiceManager": { get: () => voiceManager },
"DiscordUIController": { get: () => DiscordUIController },
"getAudioDevices": { get: () => getAudioDevices },
"populateDeviceSelect": { get: () => populateDeviceSelect },
"playTestTone": { get: () => playTestTone },
"watchDeviceChanges": { get: () => watchDeviceChanges },
"getSavedAudioPreferences": { get: () => getSavedAudioPreferences },
"saveAudioPreference": { get: () => saveAudioPreference },
"isAudioOutputSupported": { get: () => isAudioOutputSupported },
"clipRecorder": { get: () => clipRecorder },
"tacticalPingManager": { get: () => tacticalPingManager },
"floatingReactionsManager": { get: () => floatingReactionsManager },
"soundboardManager": { get: () => soundboardManager },
"adaptiveBitrateController": { get: () => adaptiveBitrateController },
"AUDIO_MEME_EFFECTS": { get: () => AUDIO_MEME_EFFECTS },
"getAudioContext": { get: () => getAudioContext },
"decodeAudioFromBlob": { get: () => decodeAudioFromBlob },
"trimAudioBuffer": { get: () => trimAudioBuffer },
"applyMemeEffect": { get: () => applyMemeEffect },
"audioBufferToWavBlob": { get: () => audioBufferToWavBlob },
"wavBlobToBase64": { get: () => wavBlobToBase64 },
"base64ToWavBlob": { get: () => base64ToWavBlob },
"playAudioBuffer": { get: () => playAudioBuffer },
"whiteboardManager": { get: () => whiteboardManager },
"WHITEBOARD_TOOLS": { get: () => WHITEBOARD_TOOLS },
"WHITEBOARD_COLORS": { get: () => WHITEBOARD_COLORS },
"getPeerCursorColor": { get: () => getPeerCursorColor },
"processImageFile": { get: () => processImageFile },
"RoomManager": { get: () => RoomManager },
"sanitizeRoomId": { get: () => sanitizeRoomId },
"getRoomMasterPeerId": { get: () => getRoomMasterPeerId },
"RelayManager": { get: () => RelayManager },
"DEFAULT_MAX_DIRECT_VIEWERS": { get: () => DEFAULT_MAX_DIRECT_VIEWERS },
"EventBus": { get: () => EventBus },
"globalBus": { get: () => globalBus },
"MessageDispatcher": { get: () => MessageDispatcher },
"globalDispatcher": { get: () => globalDispatcher },
"PluginManager": { get: () => PluginManager },
"globalPluginManager": { get: () => globalPluginManager },
"audioContextPool": { get: () => audioContextPool },
"getSharedAudioContext": { get: () => getSharedAudioContext },
"BasePlugin": { get: () => BasePlugin },
"WhiteboardPlugin": { get: () => WhiteboardPlugin },
"whiteboardPlugin": { get: () => whiteboardPlugin },
"SoundboardPlugin": { get: () => SoundboardPlugin },
"soundboardPlugin": { get: () => soundboardPlugin },
"TacticalPingPlugin": { get: () => TacticalPingPlugin },
"tacticalPingPlugin": { get: () => tacticalPingPlugin },
"ReactionsPlugin": { get: () => ReactionsPlugin },
"reactionsPlugin": { get: () => reactionsPlugin },
"ClippingPlugin": { get: () => ClippingPlugin },
"clippingPlugin": { get: () => clippingPlugin },
"initViewerApp": { get: () => initViewerApp },
"initStreamerApp": { get: () => initStreamerApp },
"initRoomApp": { get: () => initRoomApp },
"initLobbyApp": { get: () => initLobbyApp },
"roomManager": { get: () => roomManager, set: value => { roomManager = value; } },
"isRoomMasterAttempt": { get: () => isRoomMasterAttempt, set: value => { isRoomMasterAttempt = value; } },
"roomRelayManager": { get: () => roomRelayManager, set: value => { roomRelayManager = value; } },
"isTreeRelayEnabled": { get: () => isTreeRelayEnabled, set: value => { isTreeRelayEnabled = value; } },
"lastViewerTelemetry": { get: () => lastViewerTelemetry },
"savedRemoteStreams": { get: () => savedRemoteStreams },
"pendingRelayRequests": { get: () => pendingRelayRequests },
"setTreeRelayEnabled": { get: () => setTreeRelayEnabled },
"isRoomMode": { get: () => isRoomMode },
"getRoomInfoFromUrl": { get: () => getRoomInfoFromUrl },
"selectedProfile": { get: () => selectedProfile, set: value => { selectedProfile = value; } },
"customBitrateBps": { get: () => customBitrateBps, set: value => { customBitrateBps = value; } },
"maxViewers": { get: () => maxViewers, set: value => { maxViewers = value; } },
"currentRoomMode": { get: () => currentRoomMode, set: value => { currentRoomMode = value; } },
"peer": { get: () => peer, set: value => { peer = value; } },
"myId": { get: () => myId, set: value => { myId = value; } },
"localStream": { get: () => localStream, set: value => { localStream = value; } },
"isStartingStream": { get: () => isStartingStream, set: value => { isStartingStream = value; } },
"capturedSystemAudioTrack": { get: () => capturedSystemAudioTrack, set: value => { capturedSystemAudioTrack = value; } },
"capturedMicStream": { get: () => capturedMicStream, set: value => { capturedMicStream = value; } },
"activeMicProcessor": { get: () => activeMicProcessor, set: value => { activeMicProcessor = value; } },
"activeNativeCaptureProvider": { get: () => activeNativeCaptureProvider, set: value => { activeNativeCaptureProvider = value; } },
"connectedViewers": { get: () => connectedViewers },
"activeMediaCalls": { get: () => activeMediaCalls },
"activeVoiceCalls": { get: () => activeVoiceCalls },
"watchingHosts": { get: () => watchingHosts },
"discordUI": { get: () => discordUI, set: value => { discordUI = value; } },
"directViewerPeerConnections": { get: () => directViewerPeerConnections },
"directPendingCandidates": { get: () => directPendingCandidates },
"directClipStartTimers": { get: () => directClipStartTimers },
"activeNativeViewerPeers": { get: () => activeNativeViewerPeers },
"activeDirectSignaling": { get: () => activeDirectSignaling },
"processingDirectOffers": { get: () => processingDirectOffers },
"lastShownQualityPerHost": { get: () => lastShownQualityPerHost },
"unlistenNativeBridge": { get: () => unlistenNativeBridge, set: value => { unlistenNativeBridge = value; } },
"reconnectAttempts": { get: () => reconnectAttempts, set: value => { reconnectAttempts = value; } },
"reconnectTimer": { get: () => reconnectTimer, set: value => { reconnectTimer = value; } },
"copyBadge": { get: () => copyBadge },
"shareLinkBtn": { get: () => shareLinkBtn },
"streamBtn": { get: () => streamBtn },
"connectBtn": { get: () => connectBtn },
"targetInput": { get: () => targetInput },
"qualityPresetSelect": { get: () => qualityPresetSelect },
"bitrateSlider": { get: () => bitrateSlider },
"bitrateDisplay": { get: () => bitrateDisplay },
"audioModeSelect": { get: () => audioModeSelect },
"audioExcludeSelect": { get: () => audioExcludeSelect },
"desktopAudioExclusionGroup": { get: () => desktopAudioExclusionGroup },
"pickerAudioExcludeSelect": { get: () => pickerAudioExcludeSelect },
"audioTipBanner": { get: () => audioTipBanner },
"closeBannerBtn": { get: () => closeBannerBtn },
"viewerCountBadge": { get: () => viewerCountBadge },
"coopModeSelect": { get: () => coopModeSelect },
"videoCodecSelect": { get: () => videoCodecSelect },
"h264EncoderSelect": { get: () => h264EncoderSelect },
"h264EncoderGroup": { get: () => h264EncoderGroup },
"captureCursorToggle": { get: () => captureCursorToggle },
"clipBufferDurationSelect": { get: () => clipBufferDurationSelect },
"clipBufferDurationVal": { get: () => clipBufferDurationVal },
"syncClipDurationUI": { get: () => syncClipDurationUI },
"syncH264EncoderVisibility": { get: () => syncH264EncoderVisibility },
"syncMediaControlsEnvironment": { get: () => syncMediaControlsEnvironment },
"authenticatedViewers": { get: () => authenticatedViewers },
"currentPinTargetId": { get: () => currentPinTargetId, set: value => { currentPinTargetId = value; } },
"editIdBtn": { get: () => editIdBtn },
"customIdModal": { get: () => customIdModal },
"customIdInput": { get: () => customIdInput },
"customIdError": { get: () => customIdError },
"customIdSaveBtn": { get: () => customIdSaveBtn },
"customIdResetBtn": { get: () => customIdResetBtn },
"customIdCancelBtn": { get: () => customIdCancelBtn },
"roomPinInput": { get: () => roomPinInput },
"pinPromptModal": { get: () => pinPromptModal },
"viewerPinInput": { get: () => viewerPinInput },
"viewerPinError": { get: () => viewerPinError },
"viewerPinSubmitBtn": { get: () => viewerPinSubmitBtn },
"viewerPinCancelBtn": { get: () => viewerPinCancelBtn },
"getCustomStreamerId": { get: () => getCustomStreamerId },
"setCustomStreamerId": { get: () => setCustomStreamerId },
"getStoredRoomPin": { get: () => getStoredRoomPin },
"setStoredRoomPin": { get: () => setStoredRoomPin },
"getClientSessionId": { get: () => getClientSessionId },
"isCurrentlyStreaming": { get: () => isCurrentlyStreaming },
"getLocalUserDisplayName": { get: () => getLocalUserDisplayName },
"isPeerAuthorizedForMedia": { get: () => isPeerAuthorizedForMedia },
"promptViewerPin": { get: () => promptViewerPin },
"hideViewerPinModal": { get: () => hideViewerPinModal },
"submitViewerPin": { get: () => submitViewerPin },
"updateViewerCountUI": { get: () => updateViewerCountUI },
"applyCoopModeChange": { get: () => applyCoopModeChange },
"pendingNativeReconfig": { get: () => pendingNativeReconfig, set: value => { pendingNativeReconfig = value; } },
"isNativeReconfiguring": { get: () => isNativeReconfiguring, set: value => { isNativeReconfiguring = value; } },
"queueNativeReconfigure": { get: () => queueNativeReconfigure },
"applyLiveBitrateChange": { get: () => applyLiveBitrateChange },
"bitrateSliderDebounceTimer": { get: () => bitrateSliderDebounceTimer, set: value => { bitrateSliderDebounceTimer = value; } },
"syncAudioModeCapabilities": { get: () => syncAudioModeCapabilities },
"syncAudioExclusionOptions": { get: () => syncAudioExclusionOptions },
"getSelectedAudioExclusionApp": { get: () => getSelectedAudioExclusionApp },
"handleAudioExcludeChange": { get: () => handleAudioExcludeChange },
"customIdRetryAttempts": { get: () => customIdRetryAttempts, set: value => { customIdRetryAttempts = value; } },
"MAX_CUSTOM_ID_RETRIES": { get: () => MAX_CUSTOM_ID_RETRIES },
"customIdRetryTimer": { get: () => customIdRetryTimer, set: value => { customIdRetryTimer = value; } },
"getCustomIdRetryAttempts": { get: () => getCustomIdRetryAttempts },
"setCustomIdRetryAttempts": { get: () => setCustomIdRetryAttempts },
"isConfirmedReload": { get: () => isConfirmedReload, set: value => { isConfirmedReload = value; } },
"setConfirmedReload": { get: () => setConfirmedReload },
"handlePageUnload": { get: () => handlePageUnload },
"isReloadConfirmationPending": { get: () => isReloadConfirmationPending },
"showReloadConfirmationModal": { get: () => showReloadConfirmationModal },
"hideReloadConfirmationModal": { get: () => hideReloadConfirmationModal },
"handleReloadKeypress": { get: () => handleReloadKeypress },
"resetPeer": { get: () => resetPeer },
"setupRoomSession": { get: () => setupRoomSession },
"initPeer": { get: () => initPeer },
"broadcastDataMessage": { get: () => broadcastDataMessage },
"setupVoiceMediaCall": { get: () => setupVoiceMediaCall },
"handleIncomingVoiceCall": { get: () => handleIncomingVoiceCall },
"seenMessageIds": { get: () => seenMessageIds },
"isDuplicateMessage": { get: () => isDuplicateMessage },
"p2pDispatcher": { get: () => p2pDispatcher },
"pluginManager": { get: () => pluginManager },
"initPlugins": { get: () => initPlugins },
"handleIncomingP2PMessage": { get: () => handleIncomingP2PMessage },
"tuningAudioControls": { get: () => tuningAudioControls, set: value => { tuningAudioControls = value; } },
"initTuningAudioDeviceControls": { get: () => initTuningAudioDeviceControls },
"initDiscordFeatures": { get: () => initDiscordFeatures },
"setupIncomingDataConnection": { get: () => setupIncomingDataConnection },
"waitForDirectIceGathering": { get: () => waitForDirectIceGathering },
"handleStartDirectStream": { get: () => handleStartDirectStream },
"handleDirectStreamOffer": { get: () => handleDirectStreamOffer },
"handleDirectStreamAnswer": { get: () => handleDirectStreamAnswer },
"handleDirectStreamIceCandidate": { get: () => handleDirectStreamIceCandidate },
"handleDirectStreamSignaling": { get: () => handleDirectStreamSignaling },
"setupNativeBridgeListener": { get: () => setupNativeBridgeListener },
"initiateMediaCallToViewer": { get: () => initiateMediaCallToViewer },
"handleIncomingMediaCall": { get: () => handleIncomingMediaCall },
"watchFriend": { get: () => watchFriend },
"disconnectHost": { get: () => disconnectHost },
"startLocalStream": { get: () => startLocalStream },
"stopLocalStream": { get: () => stopLocalStream },
"initDesktopSupport": { get: () => initDesktopSupport },
"handleStreamBtnClick": { get: () => handleStreamBtnClick },
"checkAutoWatchUrl": { get: () => checkAutoWatchUrl },
"initFixedIdAndPinControls": { get: () => initFixedIdAndPinControls },
"facecamStream": { get: () => facecamStream, set: value => { facecamStream = value; } },
"isTogglingFacecam": { get: () => isTogglingFacecam, set: value => { isTogglingFacecam = value; } },
"toggleFacecam": { get: () => toggleFacecam },
"tacticalPingAbortController": { get: () => tacticalPingAbortController, set: value => { tacticalPingAbortController = value; } },
"initTacticalPing": { get: () => initTacticalPing },
"floatingReactionsAbortController": { get: () => floatingReactionsAbortController, set: value => { floatingReactionsAbortController = value; } },
"initFloatingReactions": { get: () => initFloatingReactions },
"initAdaptiveBitrate": { get: () => initAdaptiveBitrate },
"initFacecam": { get: () => initFacecam },
"currentPreviewController": { get: () => currentPreviewController, set: value => { currentPreviewController = value; } },
"activeClipBlob": { get: () => activeClipBlob, set: value => { activeClipBlob = value; } },
"activeAudioBuffer": { get: () => activeAudioBuffer, set: value => { activeAudioBuffer = value; } },
"activeEffectId": { get: () => activeEffectId, set: value => { activeEffectId = value; } },
"closeClipPostModal": { get: () => closeClipPostModal },
"openClipPostModal": { get: () => openClipPostModal },
"openWhiteboardModal": { get: () => openWhiteboardModal, set: value => { openWhiteboardModal = value; } },
"closeWhiteboardModal": { get: () => closeWhiteboardModal, set: value => { closeWhiteboardModal = value; } },
"toggleWhiteboardModal": { get: () => toggleWhiteboardModal, set: value => { toggleWhiteboardModal = value; } },
"initWhiteboard": { get: () => initWhiteboard },
"initGamerFeatures": { get: () => initGamerFeatures },
"appDomInitialized": { get: () => appDomInitialized, set: value => { appDomInitialized = value; } },
"initAppDom": { get: () => initAppDom },
"gamerKeybindingsInitialized": { get: () => gamerKeybindingsInitialized, set: value => { gamerKeybindingsInitialized = value; } },
"initGamerKeybindings": { get: () => initGamerKeybindings },
"initGreenRoomLobby": { get: () => initGreenRoomLobby },
"appBootstrapped": { get: () => appBootstrapped, set: value => { appBootstrapped = value; } },
"bootstrapApp": { get: () => bootstrapApp }
});


export {
  EventBus,
  globalBus,
  MessageDispatcher,
  globalDispatcher,
  PluginManager,
  audioContextPool,
  getSharedAudioContext,
  BasePlugin,
  WhiteboardPlugin,
  whiteboardPlugin,
  SoundboardPlugin,
  soundboardPlugin,
  TacticalPingPlugin,
  tacticalPingPlugin,
  ReactionsPlugin,
  reactionsPlugin,
  ClippingPlugin,
  clippingPlugin,
  initViewerApp,
  initStreamerApp,
  initRoomApp,
  initLobbyApp
};

// Estado da Aplicação
export let roomManager = null;
let isRoomMasterAttempt = true;

// Gerenciamento de Árvore P2P Relay (Tree Mesh)
export let roomRelayManager = null;
export let isTreeRelayEnabled = true;
const lastViewerTelemetry = new Map(); // peerId -> { rtt, packetLoss }
const savedRemoteStreams = new Map();  // hostId -> MediaStream
const pendingRelayRequests = [];       // Array<{ targetPeerId, hostPeerId }>

export function setTreeRelayEnabled(...args) { return setTreeRelayEnabledImpl(compatibilityPorts, ...args); }

export function isRoomMode(...args) { return isRoomModeImpl(compatibilityPorts, ...args); }

export function getRoomInfoFromUrl(...args) { return getRoomInfoFromUrlImpl(compatibilityPorts, ...args); }

let selectedProfile = DEFAULT_PROFILE;
let customBitrateBps = DEFAULT_BITRATE_BPS;
let maxViewers = MAX_VIEWERS_DEFAULT;
let currentRoomMode = ROOM_MODES.PUBLIC;

let peer = null;
let myId = null;
let localStream = null;
let isStartingStream = false;
let capturedSystemAudioTrack = null;
let capturedMicStream = null;
let activeMicProcessor = null;
let activeNativeCaptureProvider = null;

// Conexões ativas
const connectedViewers = new Map(); // PeerId -> DataConnection
const activeMediaCalls = new Map(); // PeerId -> MediaConnection
const activeVoiceCalls = new Map(); // PeerId -> MediaConnection (Voz)
const watchingHosts = new Map();    // HostId -> { state: 'CONNECTING'|'CONNECTED'|'CANCELLED'|'CLOSED', conn, call, timeoutTimer }
export let discordUI = null;



// Stream direto GStreamer / webrtcbin (Alternativa 1)
const directViewerPeerConnections = new Map(); // HostId -> RTCPeerConnection (no espectador)
const directPendingCandidates = new Map();     // HostId -> Array de candidatos ICE (no espectador)
const directClipStartTimers = new Map();       // HostId -> timerId de debounce para início do clipping
const activeNativeViewerPeers = new Set();     // ViewerId -> Set de peers com ponte ativa no Rust (no transmissor)
const activeDirectSignaling = new Set();       // ViewerId -> Set de peers em negociação (no transmissor)
const processingDirectOffers = new Set();      // ViewerId -> Set de peers com oferta sendo processada (no transmissor)
const lastShownQualityPerHost = new Map();     // HostId -> string da última qualidade notificada
let unlistenNativeBridge = null;

// Reconexão exponencial
let reconnectAttempts = 0;
let reconnectTimer = null;

// Elementos DOM
const copyBadge = document.getElementById('copy-badge');
const shareLinkBtn = document.getElementById('share-link-btn');
const streamBtn = document.getElementById('stream-btn');
const connectBtn = document.getElementById('connect-btn');
const targetInput = document.getElementById('target-id');
const qualityPresetSelect = document.getElementById('quality-preset');
const bitrateSlider = document.getElementById('bitrate-slider');
const bitrateDisplay = document.getElementById('bitrate-display');
const audioModeSelect = document.getElementById('audio-mode-select');
const audioExcludeSelect = document.getElementById('audio-exclude-select');
const desktopAudioExclusionGroup = document.getElementById('desktop-audio-exclusion-group');
const pickerAudioExcludeSelect = document.getElementById('picker-audio-exclude-select');
const audioTipBanner = document.getElementById('audio-tip-banner');
const closeBannerBtn = document.getElementById('close-banner-btn');
const viewerCountBadge = document.getElementById('viewer-count');
const coopModeSelect = document.getElementById('coop-mode-select');
const videoCodecSelect = document.getElementById('video-codec-select');
const h264EncoderSelect = document.getElementById('h264-encoder-select');
const h264EncoderGroup = document.getElementById('h264-encoder-group');
const captureCursorToggle = document.getElementById('capture-cursor-toggle');
const clipBufferDurationSelect = document.getElementById('clip-buffer-duration-select');
const clipBufferDurationVal = document.getElementById('clip-buffer-duration-val');

export function syncClipDurationUI(...args) { return syncClipDurationUIImpl(compatibilityPorts, ...args); }





export function syncH264EncoderVisibility(...args) { return syncH264EncoderVisibilityImpl(compatibilityPorts, ...args); }

export function syncMediaControlsEnvironment(...args) { return syncMediaControlsEnvironmentImpl(compatibilityPorts, ...args); }







// Espectadores autorizados (após verificação de PIN se houver)
export const authenticatedViewers = new Set();
let currentPinTargetId = null;

// Elementos DOM para ID Fixo Permanente
const editIdBtn = document.getElementById('edit-id-btn');
const customIdModal = document.getElementById('custom-id-modal');
const customIdInput = document.getElementById('custom-id-input');
const customIdError = document.getElementById('custom-id-error');
const customIdSaveBtn = document.getElementById('custom-id-save-btn');
const customIdResetBtn = document.getElementById('custom-id-reset-btn');
const customIdCancelBtn = document.getElementById('custom-id-cancel-btn');
const roomPinInput = document.getElementById('room-pin-input');

// Elementos DOM para Modal de Desafio de PIN do Espectador
const pinPromptModal = document.getElementById('pin-prompt-modal');
const viewerPinInput = document.getElementById('viewer-pin-input');
const viewerPinError = document.getElementById('viewer-pin-error');
const viewerPinSubmitBtn = document.getElementById('viewer-pin-submit-btn');
const viewerPinCancelBtn = document.getElementById('viewer-pin-cancel-btn');

export function getCustomStreamerId(...args) { return getCustomStreamerIdImpl(compatibilityPorts, ...args); }

export function setCustomStreamerId(...args) { return setCustomStreamerIdImpl(compatibilityPorts, ...args); }

export function getStoredRoomPin(...args) { return getStoredRoomPinImpl(compatibilityPorts, ...args); }

export function setStoredRoomPin(...args) { return setStoredRoomPinImpl(compatibilityPorts, ...args); }

export function getClientSessionId(...args) { return getClientSessionIdImpl(compatibilityPorts, ...args); }

export function isCurrentlyStreaming(...args) { return isCurrentlyStreamingImpl(compatibilityPorts, ...args); }

export function getLocalUserDisplayName(...args) { return getLocalUserDisplayNameImpl(compatibilityPorts, ...args); }

export function isPeerAuthorizedForMedia(...args) { return isPeerAuthorizedForMediaImpl(compatibilityPorts, ...args); }

export function promptViewerPin(...args) { return promptViewerPinImpl(compatibilityPorts, ...args); }

export function hideViewerPinModal(...args) { return hideViewerPinModalImpl(compatibilityPorts, ...args); }

export function submitViewerPin(...args) { return submitViewerPinImpl(compatibilityPorts, ...args); }

function updateViewerCountUI(...args) { return updateViewerCountUIImpl(compatibilityPorts, ...args); }

// ==========================================
// CONFIGURAÇÕES E LISTENERS CO-OP (PLAYER 2)
// ==========================================

export function applyCoopModeChange(...args) { return applyCoopModeChangeImpl(compatibilityPorts, ...args); }



// Configura callbacks de autorização e de atualização de interface do Co-op




// Tecla Escape como killswitch / botão de pânico rápido no streamer para revogar Player 2


// ==========================================
// CONTROLES DE TUNING & PRESETS
// ==========================================

let pendingNativeReconfig = null;
let isNativeReconfiguring = false;

function queueNativeReconfigure(...args) { return queueNativeReconfigureImpl(compatibilityPorts, ...args); }

export function applyLiveBitrateChange(...args) { return applyLiveBitrateChangeImpl(compatibilityPorts, ...args); }



let bitrateSliderDebounceTimer = null;



// Sincroniza capacidades do sistema para opções de áudio
export function syncAudioModeCapabilities(...args) { return syncAudioModeCapabilitiesImpl(compatibilityPorts, ...args); }

export function syncAudioExclusionOptions(...args) { return syncAudioExclusionOptionsImpl(compatibilityPorts, ...args); }

export function getSelectedAudioExclusionApp(...args) { return getSelectedAudioExclusionAppImpl(compatibilityPorts, ...args); }

export function handleAudioExcludeChange(...args) { return handleAudioExcludeChangeImpl(compatibilityPorts, ...args); }




// Hot Swapping dinâmico de fonte de áudio ao vivo sem desconectar espectadores




// ==========================================
// INICIALIZAÇÃO DO PEERJS & SINALIZAÇÃO
// ==========================================

export let customIdRetryAttempts = 0;
export const MAX_CUSTOM_ID_RETRIES = 3;
let customIdRetryTimer = null;

export function getCustomIdRetryAttempts(...args) { return getCustomIdRetryAttemptsImpl(compatibilityPorts, ...args); }

export function setCustomIdRetryAttempts(...args) { return setCustomIdRetryAttemptsImpl(compatibilityPorts, ...args); }

let isConfirmedReload = false;

export function setConfirmedReload(...args) { return setConfirmedReloadImpl(compatibilityPorts, ...args); }

export function handlePageUnload(...args) { return handlePageUnloadImpl(compatibilityPorts, ...args); }

export function isReloadConfirmationPending(...args) { return isReloadConfirmationPendingImpl(compatibilityPorts, ...args); }

export function showReloadConfirmationModal(...args) { return showReloadConfirmationModalImpl(compatibilityPorts, ...args); }

export function hideReloadConfirmationModal(...args) { return hideReloadConfirmationModalImpl(compatibilityPorts, ...args); }

export function handleReloadKeypress(...args) { return handleReloadKeypressImpl(compatibilityPorts, ...args); }



export function resetPeer(...args) { return resetPeerImpl(compatibilityPorts, ...args); }

export function setupRoomSession(...args) { return setupRoomSessionImpl(compatibilityPorts, ...args); }

export function initPeer(...args) { return initPeerImpl(compatibilityPorts, ...args); }

// ==========================================
// DISCORD VOICE & CHAT P2P INTEGRATION
// ==========================================

export function broadcastDataMessage(...args) { return broadcastDataMessageImpl(compatibilityPorts, ...args); }

export function setupVoiceMediaCall(...args) { return setupVoiceMediaCallImpl(compatibilityPorts, ...args); }

export function handleIncomingVoiceCall(...args) { return handleIncomingVoiceCallImpl(compatibilityPorts, ...args); }

export const seenMessageIds = new Set();
export function isDuplicateMessage(...args) { return isDuplicateMessageImpl(compatibilityPorts, ...args); }

export const p2pDispatcher = globalDispatcher;







export const pluginManager = globalPluginManager;






export function initPlugins(...args) { return initPluginsImpl(compatibilityPorts, ...args); }

export function handleIncomingP2PMessage(...args) { return handleIncomingP2PMessageImpl(compatibilityPorts, ...args); }

export let tuningAudioControls = null;

export function initTuningAudioDeviceControls(...args) { return initTuningAudioDeviceControlsImpl(compatibilityPorts, ...args); }

export function initDiscordFeatures(...args) { return initDiscordFeaturesImpl(compatibilityPorts, ...args); }

// Controle: Transmissor recebe pedido de espectador
export function setupIncomingDataConnection(...args) { return setupIncomingDataConnectionImpl(compatibilityPorts, ...args); }

// ==========================================
// STREAM DIRETO GSTREAMER (ALTERNATIVA 1)
// ==========================================

function waitForDirectIceGathering(...args) { return waitForDirectIceGatheringImpl(compatibilityPorts, ...args); }

function handleStartDirectStream(...args) { return handleStartDirectStreamImpl(compatibilityPorts, ...args); }

function handleDirectStreamOffer(...args) { return handleDirectStreamOfferImpl(compatibilityPorts, ...args); }

function handleDirectStreamAnswer(...args) { return handleDirectStreamAnswerImpl(compatibilityPorts, ...args); }

function handleDirectStreamIceCandidate(...args) { return handleDirectStreamIceCandidateImpl(compatibilityPorts, ...args); }

function handleDirectStreamSignaling(...args) { return handleDirectStreamSignalingImpl(compatibilityPorts, ...args); }

export function setupNativeBridgeListener(...args) { return setupNativeBridgeListenerImpl(compatibilityPorts, ...args); }

// Transmissor envia o vídeo com foco em alta fluidez (Idempotente)
export function initiateMediaCallToViewer(...args) { return initiateMediaCallToViewerImpl(compatibilityPorts, ...args); }

// Espectador recebe o stream do amigo (Rejeita chamadas não solicitadas)
function handleIncomingMediaCall(...args) { return handleIncomingMediaCallImpl(compatibilityPorts, ...args); }

// ==========================================
// CONECTAR COMO ESPECTADOR
// ==========================================

export function watchFriend(...args) { return watchFriendImpl(compatibilityPorts, ...args); }

export function disconnectHost(...args) { return disconnectHostImpl(compatibilityPorts, ...args); }

// Expõe globalmente para compatibilidade




// ==========================================
// INICIAR E ENCERRAR TRANSMISSÃO LOCAL
// ==========================================

export function startLocalStream(...args) { return startLocalStreamImpl(compatibilityPorts, ...args); }

export function stopLocalStream(...args) { return stopLocalStreamImpl(compatibilityPorts, ...args); }

/**
 * Inicialização e controle dos recursos do Desktop App (Tauri / Rust)
 */
export function initDesktopSupport(...args) { return initDesktopSupportImpl(compatibilityPorts, ...args); }

export function handleStreamBtnClick(...args) { return handleStreamBtnClickImpl(compatibilityPorts, ...args); }



// Auto-conexão por URL
function checkAutoWatchUrl(...args) { return checkAutoWatchUrlImpl(compatibilityPorts, ...args); }

// ==========================================
// INICIALIZAÇÃO DE ID FIXO E PIN
// ==========================================

export function initFixedIdAndPinControls(...args) { return initFixedIdAndPinControlsImpl(compatibilityPorts, ...args); }

// ==========================================
// RECURSOS GAMER PROFISSIONAIS (CLIPPING, PING, REAÇÕES, SOUNDBOARD, ABR, FACECAM, PIP)
// ==========================================

export let facecamStream = null;
let isTogglingFacecam = false;

export function toggleFacecam(...args) { return toggleFacecamImpl(compatibilityPorts, ...args); }

let tacticalPingAbortController = null;

export function initTacticalPing(...args) { return initTacticalPingImpl(compatibilityPorts, ...args); }

let floatingReactionsAbortController = null;

export function initFloatingReactions(...args) { return initFloatingReactionsImpl(compatibilityPorts, ...args); }

export function initAdaptiveBitrate(...args) { return initAdaptiveBitrateImpl(compatibilityPorts, ...args); }

export function initFacecam(...args) { return initFacecamImpl(compatibilityPorts, ...args); }

let currentPreviewController = null;
let activeClipBlob = null;
let activeAudioBuffer = null;
let activeEffectId = 'none';

export function closeClipPostModal(...args) { return closeClipPostModalImpl(compatibilityPorts, ...args); }

export function openClipPostModal(...args) { return openClipPostModalImpl(compatibilityPorts, ...args); }

export let openWhiteboardModal = null;
export let closeWhiteboardModal = null;
export let toggleWhiteboardModal = null;

export function initWhiteboard(...args) { return initWhiteboardImpl(compatibilityPorts, ...args); }

export function initGamerFeatures(...args) { return initGamerFeaturesImpl(compatibilityPorts, ...args); }

// ==========================================
// INICIALIZAÇÃO GERAL
// ==========================================

let appDomInitialized = false;

export function initAppDom(...args) { return initAppDomImpl(compatibilityPorts, ...args); }

// ==========================================
// ATALHOS DE TECLADO GAMER (F = Fullscreen, M = Mute)
// ==========================================

let gamerKeybindingsInitialized = false;

export function initGamerKeybindings(...args) { return initGamerKeybindingsImpl(compatibilityPorts, ...args); }

export function initGreenRoomLobby(...args) { return initGreenRoomLobbyImpl(compatibilityPorts, ...args); }

let appBootstrapped = false;

export function bootstrapApp() {
  if (appBootstrapped) return;
  if (typeof window !== 'undefined' && window.__SEEMYGAME_BOOTSTRAPPED__) {
    // Se a página já foi inicializada por um entrypoint dedicado, não executa o bootstrap legado
    return;
  }
  appBootstrapped = true;
  if (typeof window !== 'undefined') {
    window.__SEEMYGAME_BOOTSTRAPPED__ = 'app';
  }
  initLegacyBindings();
  initAppDom();
}



let legacyBindingsMounted = false;
export function initLegacyBindings() {
  if (legacyBindingsMounted) return;
  legacyBindingsMounted = true;
if (typeof window !== 'undefined') {
  window.whiteboardManager = whiteboardManager;
}
if (typeof window !== 'undefined') {
  window.activeMediaCalls = activeMediaCalls;
  window.watchingHosts = watchingHosts;
  window.savedRemoteStreams = savedRemoteStreams;
  window.getRoomRelayManager = () => roomRelayManager;
  window.setTreeRelayEnabled = setTreeRelayEnabled;
  window.isTreeRelayEnabled = () => isTreeRelayEnabled;
  window.getTreeRelayTopology = () => roomRelayManager ? roomRelayManager.getTopology() : null;
  window.getTreeRelaySavings = () => roomRelayManager ? roomRelayManager.calculateBandwidthSavings(customBitrateBps) : null;
  window.getLastMetrics = getLastMetrics;
  window.getPeer = () => peer;
}
try {
  const savedCodec = localStorage.getItem('seemygame_video_codec');
  if (savedCodec && videoCodecSelect) {
    videoCodecSelect.value = savedCodec;
  }
  const savedEncoder = localStorage.getItem('seemygame_h264_encoder');
  if (savedEncoder && h264EncoderSelect) {
    h264EncoderSelect.value = savedEncoder;
  }
  const savedCursor = localStorage.getItem('seemygame_capture_cursor');
  if (savedCursor !== null && captureCursorToggle) {
    captureCursorToggle.checked = savedCursor === 'true';
  }
  const savedExclude = localStorage.getItem('seemygame_audio_exclude_app');
  if (savedExclude) {
    if (audioExcludeSelect) audioExcludeSelect.value = savedExclude;
    if (pickerAudioExcludeSelect) pickerAudioExcludeSelect.value = savedExclude;
  }
  const savedClipDuration = localStorage.getItem('seemygame_clip_duration');
  if (savedClipDuration !== null) {
    const parsed = Number(savedClipDuration);
    if (!isNaN(parsed) && parsed >= 0) {
      clipRecorder.setMaxDurationSeconds(parsed);
      syncClipDurationUI(parsed);
    }
  }
} catch (e) {}
if (clipBufferDurationSelect) {
  clipBufferDurationSelect.addEventListener('change', () => {
    const val = Number(clipBufferDurationSelect.value);
    clipRecorder.setMaxDurationSeconds(val);
    syncClipDurationUI(val);
    const label = val === 0 ? 'Full (Toda a Sessão)' : `${val}s`;
    showToast(`⏱️ Buffer de gravação alterado para ${label}`, 'info');
  });
}
if (videoCodecSelect) {
  videoCodecSelect.addEventListener('change', () => {
    syncMediaControlsEnvironment();
    try { localStorage.setItem('seemygame_video_codec', videoCodecSelect.value); } catch (_) {}
    if (localStream || activeNativeCaptureProvider?.session) showToast('O novo codec será usado ao reiniciar a transmissão.', 'info');
  });
  syncMediaControlsEnvironment();
}
if (h264EncoderSelect) {
  h264EncoderSelect.addEventListener('change', () => {
    syncMediaControlsEnvironment();
    try { localStorage.setItem('seemygame_h264_encoder', h264EncoderSelect.value); } catch (_) {}
    if (localStream || activeNativeCaptureProvider?.session) showToast('O novo encoder será usado ao reiniciar a transmissão.', 'info');
  });
}
if (captureCursorToggle) {
  captureCursorToggle.addEventListener('change', (e) => {
    try { localStorage.setItem('seemygame_capture_cursor', String(e.target.checked)); } catch (err) {}
    if (isDesktopApp() && activeNativeCaptureProvider?.session?.sessionId) {
      activeNativeCaptureProvider.reconfigure({ showCursor: e.target.checked }).catch((err) => {
        console.warn('Falha ao alternar cursor na captura nativa:', err);
      });
    }
    showToast(e.target.checked ? '🖱️ Cursor visível na transmissão' : '🚫 Cursor oculto na transmissão', 'info');
  });
}
if (coopModeSelect) {
  coopModeSelect.addEventListener('change', (e) => {
    applyCoopModeChange(e.target.value);
  });
}
registerCoopPromptHandler(({ peerId, approve, deny }) => {
  showCoopPromptModal(peerId, approve, deny);
});
registerCoopStateChangeHandler((state) => {
  updateCoopUI(state);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const state = getCoopState();
    if (state.activePlayer2PeerId) {
      revokePlayer2();
      showToast('🛑 Controle do Player 2 revogado via tecla Escape!', 'info');
    }
  }
});
if (qualityPresetSelect) {
  qualityPresetSelect.addEventListener('change', (e) => {
    selectedProfile = QUALITY_PROFILES[e.target.value] || QUALITY_PROFILES.balanced;
    customBitrateBps = selectedProfile.bitrate;
    if (bitrateSlider) bitrateSlider.value = Math.round(customBitrateBps / 1000);
    if (bitrateDisplay) bitrateDisplay.innerText = `${(customBitrateBps / 1000000).toFixed(1)} Mbps`;
    
    showToast(`Perfil selecionado: ${selectedProfile.label}`, 'info');

    // Aplica constraints dinamicamente na trilha de vídeo existente
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        videoTrack.applyConstraints({
          width: { ideal: selectedProfile.width },
          height: { ideal: selectedProfile.height },
          frameRate: { ideal: selectedProfile.fps }
        }).catch((err) => {
          console.warn('Falha ao aplicar restrições dinâmicas na trilha de vídeo:', err);
        });
      }
    }

    applyLiveBitrateChange();
  });
}
if (bitrateSlider) {
  bitrateSlider.addEventListener('input', (e) => {
    const kbps = parseInt(e.target.value, 10);
    customBitrateBps = kbps * 1000;
    if (bitrateDisplay) bitrateDisplay.innerText = `${(kbps / 1000).toFixed(1)} Mbps`;
    if (bitrateSliderDebounceTimer) clearTimeout(bitrateSliderDebounceTimer);
    bitrateSliderDebounceTimer = setTimeout(() => {
      bitrateSliderDebounceTimer = null;
      applyLiveBitrateChange();
    }, 250);
  });

  bitrateSlider.addEventListener('change', () => {
    if (bitrateSliderDebounceTimer) {
      clearTimeout(bitrateSliderDebounceTimer);
      bitrateSliderDebounceTimer = null;
    }
    applyLiveBitrateChange();
  });
}
if (audioExcludeSelect) {
  audioExcludeSelect.addEventListener('change', (e) => handleAudioExcludeChange(e.target.value));
}
if (pickerAudioExcludeSelect) {
  pickerAudioExcludeSelect.addEventListener('change', (e) => handleAudioExcludeChange(e.target.value));
}
if (audioModeSelect) {
  let activeConfirmedAudioMode = audioModeSelect.value || 'system';

  audioModeSelect.addEventListener('change', async (e) => {
    const previousMode = activeConfirmedAudioMode;
    let newMode = e.target.value;
    const processOption = audioModeSelect.querySelector('option[value="process"]');
    const isLiveNative = isDesktopApp() && activeNativeCaptureProvider?.session?.sessionId;
    const desktopAudioExclusionGroup = document.getElementById('desktop-audio-exclusion-group');
    if (desktopAudioExclusionGroup) {
      desktopAudioExclusionGroup.style.display = (isDesktopApp() && newMode === 'system') ? 'block' : 'none';
    }

    if (newMode === 'process') {
      if (processOption && processOption.disabled) {
        showToast('⚠️ Áudio exclusivo de janela requer Windows 11+. Esta opção não está disponível no Windows 10.', 'warning', 5000);
        audioModeSelect.value = previousMode || 'system';
        return;
      }
      if (isDesktopApp()) {
        try {
          const caps = await getNativeCaptureCapabilities();
          if (!caps.supports_process_audio) {
            showToast('⚠️ Áudio exclusivo de janela requer Windows 11+. Esta opção não está disponível no Windows 10.', 'warning', 5000);
            audioModeSelect.value = previousMode || 'system';
            return;
          }
        } catch (_) {
          audioModeSelect.value = previousMode || 'system';
          return;
        }
      }
    }

    // Se captura nativa desktop estiver ativa, reconfigura no backend primeiro e valida
    if (isLiveNative) {
      try {
        await activeNativeCaptureProvider.reconfigure({ audioMode: newMode });
        activeConfirmedAudioMode = newMode;
      } catch (err) {
        console.warn('Falha ao reconfigurar modo de áudio nativo:', err);
        audioModeSelect.value = previousMode;
        const msg = err?.message || 'Ativar áudio nativo durante uma transmissão iniciada sem áudio requer reiniciar a transmissão.';
        showToast(`⚠️ ${msg}`, 'error', 6000);
        return;
      }
    } else {
      activeConfirmedAudioMode = newMode;
    }

    if (localStream) {
      try {
        let newAudioTrack = null;

        if (newMode === 'mic') {
          if (!capturedMicStream || !capturedMicStream.getAudioTracks()[0] || capturedMicStream.getAudioTracks()[0].readyState !== 'live') {
            capturedMicStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
          }
          if (activeMicProcessor) {
            activeMicProcessor.destroy();
            activeMicProcessor = null;
          }
          activeMicProcessor = applyMicrophoneProcessing(capturedMicStream);
          newAudioTrack = activeMicProcessor.processedStream.getAudioTracks()[0] || capturedMicStream.getAudioTracks()[0] || null;

          localStream.getAudioTracks().forEach(t => {
            if (t !== capturedSystemAudioTrack) {
              t.stop();
            }
            localStream.removeTrack(t);
          });

          if (newAudioTrack) {
            localStream.addTrack(newAudioTrack);
            showToast('🎙️ Microfone com filtro e Noise Gate ativado!', 'success');
          }
        } else if (newMode === 'none') {
          if (activeMicProcessor) {
            activeMicProcessor.destroy();
            activeMicProcessor = null;
          }
          localStream.getAudioTracks().forEach(t => {
            if (t !== capturedSystemAudioTrack) {
              t.stop();
            }
            localStream.removeTrack(t);
          });
          newAudioTrack = null;
          showToast('🔇 Áudio desativado (apenas vídeo).', 'info');
        } else if (newMode === 'process') {
          if (activeMicProcessor) {
            activeMicProcessor.destroy();
            activeMicProcessor = null;
          }
          if (isDesktopApp() && activeNativeCaptureProvider) {
            showToast('🎮 Áudio isolado da janela/processo ativado!', 'success');
          } else if (capturedSystemAudioTrack && capturedSystemAudioTrack.readyState === 'live') {
            localStream.getAudioTracks().forEach(t => {
              if (t !== capturedSystemAudioTrack) {
                t.stop();
              }
              localStream.removeTrack(t);
            });
            localStream.addTrack(capturedSystemAudioTrack);
            newAudioTrack = capturedSystemAudioTrack;
            showToast('🔊 Áudio do aplicativo/jogo ativado!', 'success');
          } else {
            showToast('ℹ️ No navegador, o áudio deve ser compartilhado pela janela ao iniciar.', 'info', 6000);
          }
        }

        // Hot Swapping de áudio no WebRTC para cada chamada ativa
        activeMediaCalls.forEach((call) => {
          if (call && call.peerConnection) {
            swapStreamAudioTrack(call.peerConnection, newAudioTrack);
          }
        });

        // Atualiza VU Meter local
        if (newAudioTrack) {
          initAudioAnalyser(localStream, 'local-me');
        } else {
          stopAudioAnalyser('local-me');
        }
      } catch (err) {
        console.error('Erro ao trocar modo de áudio:', err);
        audioModeSelect.value = previousMode;
        activeConfirmedAudioMode = previousMode;
        showToast(`Erro ao mudar fonte de áudio: ${err.message}`, 'error');
        return;
      }
    }

    const isCurrentlyStreaming = Boolean(localStream || (isDesktopApp() && activeNativeCaptureProvider?.session?.sessionId));

    // Atualiza estado local da sala apenas se estiver transmitindo
    if (roomManager && isCurrentlyStreaming) {
      roomManager.setLocalStreaming(true, { audioMode: activeConfirmedAudioMode });
    }

    // Notifica todos os espectadores se estiver transmitindo
    if (isCurrentlyStreaming) {
      const audioMsg = {
        type: 'STREAM_CONFIG_UPDATED',
        audioMode: activeConfirmedAudioMode,
        hasAudio: activeConfirmedAudioMode !== 'none'
      };

      connectedViewers.forEach((conn) => {
        try { conn.send(audioMsg); } catch (e) {}
      });

      if (roomManager) {
        roomManager.broadcast(audioMsg);
      }
    }

    if (!localStream) {
      const label = e.target.options[e.target.selectedIndex] ? e.target.options[e.target.selectedIndex].text : activeConfirmedAudioMode;
      showToast(`Fonte de áudio: ${label}`, 'info');
    }
  });
}
if (closeBannerBtn && audioTipBanner) {
  closeBannerBtn.addEventListener('click', () => {
    audioTipBanner.style.display = 'none';
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleReloadKeypress, true);

  window.addEventListener('beforeunload', (e) => {
    if (isConfirmedReload) {
      handlePageUnload();
      return;
    }
    const isStreaming = Boolean(localStream || activeNativeCaptureProvider?.session?.sessionId || (roomManager && roomManager.localStreamingState?.isStreaming));
    if (isStreaming) {
      e.preventDefault();
      e.returnValue = 'Você está com uma transmissão de tela ativa. Deseja realmente sair ou recarregar?';
      return e.returnValue;
    }
    handlePageUnload();
  });

  window.addEventListener('pagehide', handlePageUnload);
}
p2pDispatcher.register('CHAT_MESSAGE', (data, sourceConn) => {
  if (data.message) {
    chatManager.addMessage(data.message);
    globalBus.emit('chat:message-received', data.message);
    if (!isRoomMode() && connectedViewers.size > 0) {
      broadcastDataMessage(data, sourceConn?.peer);
    }
  }
}, { description: 'Chat Message' });
p2pDispatcher.register('VOICE_STATE_UPDATE', (data, sourceConn) => {
  voiceManager.updateParticipantState(data.peerId, {
    isSpeaking: data.isSpeaking,
    isMuted: data.isMuted,
    isDeafened: data.isDeafened,
  });
  globalBus.emit('voice:state-updated', data);
  if (!isRoomMode() && connectedViewers.size > 0) {
    broadcastDataMessage(data, sourceConn?.peer);
  }
}, { description: 'Voice State Update' });
p2pDispatcher.register('VOICE_SIGNAL', (data, sourceConn) => {
  if (data.action === 'LEAVE') {
    voiceManager.removeRemoteParticipant(data.peerId);
    const call = activeVoiceCalls.get(data.peerId);
    if (call) {
      try { call.close(); } catch (e) {}
      activeVoiceCalls.delete(data.peerId);
    }
  } else if (data.action === 'HOST_VOICE_ACTIVE' || data.action === 'VOICE_JOINED') {
    if (sourceConn?.peer && data.peerId && data.peerId !== sourceConn.peer) {
      console.warn(`[VOICE_SIGNAL] Rejeitando peerId forjado: ${data.peerId} vindo de ${sourceConn.peer}`);
      return;
    }
    if (data.action === 'HOST_VOICE_ACTIVE') {
      showToast('O Streamer está na sala de voz!', 'info');
    } else {
      showToast(`${data.name || 'Um amigo'} entrou na sala de voz!`, 'info');
    }
    if (voiceManager.isInVoice && voiceManager.localStream && peer && !peer.destroyed && !activeVoiceCalls.has(data.peerId)) {
      const call = peer.call(data.peerId, voiceManager.localStream, {
        metadata: { type: 'VOICE_CHAT', name: voiceManager.myName, role: voiceManager.myRole },
      });
      setupVoiceMediaCall(call, data.peerId);
    }
  }
  globalBus.emit('voice:signal', data);
  if (!isRoomMode() && connectedViewers.size > 0) {
    broadcastDataMessage(data, sourceConn?.peer);
  }
}, { description: 'Voice Signaling' });
pluginManager.register(whiteboardPlugin);
pluginManager.register(soundboardPlugin);
pluginManager.register(tacticalPingPlugin);
pluginManager.register(reactionsPlugin);
pluginManager.register(clippingPlugin);
window.disconnectHost = disconnectHost;
if (connectBtn && targetInput) {
  connectBtn.addEventListener('click', () => {
    const val = targetInput.value;
    if (val) {
      watchFriend(val);
      targetInput.value = '';
    } else {
      showToast('Insira o ID ou link de um amigo.', 'error');
    }
  });

  targetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      connectBtn.click();
    }
  });
}
if (streamBtn) {
  streamBtn.addEventListener('click', handleStreamBtnClick);
}

  initAppDom();
}
