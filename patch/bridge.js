if (typeof window !== "undefined") {
    window.__ocNav = Object.freeze({
      revealMessage,
      scrollToEnd,
      anchor,
      get scroller() {
        return scroller;
      },
      setPendingMessage: (id) => setUi("pendingMessage", id),
      pendingMessage: () => ui.pendingMessage,
      clearPendingMessage: () => setUi("pendingMessage", void 0),
      sessionID: () => params.id,
      messagesReady: () => messagesReady(),
      historyMore: () => historyMore(),
      historyLoading: () => historyLoading(),
      loadMore: (sid) => sync2().session.history.loadMore(sid),
      currentMessageId: () => store2.messageId,
      setActiveMessage,
      autoScroll: {
        pause: autoScroll.pause,
        resume: autoScroll.resume
      },
      __ocBridge: "opencode-ocnav-bridge"
    });
  }