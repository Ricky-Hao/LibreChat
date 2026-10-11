import { useRef, useMemo, useCallback, useLayoutEffect, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { MouseEventHandler } from 'react';
import { useMessagesConversation, useMessagesSubmission } from '~/Providers';
import { reconcileMessageContentLayout } from './messageLayout';
import { autoScrollAtom } from '~/store/autoScroll';

const resizeFollowThreshold = 120;
const attachThreshold = 150;
/** Fallback for browsers that do not report scrollend. */
const glideTimeout = 700;

export type ScrollNavigation = {
  conversationKey: string | undefined;
  ready: boolean;
  /** Only an explicit send, never a restored resume submission. */
  explicitSendId?: string;
};

export default function useMessageScrolling(
  messagesTree?: TMessage[] | null,
  navigation?: ScrollNavigation,
) {
  const autoScroll = useAtomValue(autoScrollAtom);
  const { conversation, conversationId } = useMessagesConversation();
  const { setAbortScroll, isSubmitting, abortScroll } = useMessagesSubmission();
  const conversationKey = navigation?.conversationKey ?? conversationId;
  const treeId = messagesTree?.[0]?.conversationId ?? conversationKey;
  const ready =
    navigation?.ready !== false &&
    conversationKey === conversationId &&
    treeId === conversationKey &&
    !!messagesTree?.length;

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  /** A visit, not a conversation id: A -> new -> A must arm again. */
  const visit = useMemo(() => ({ conversationKey }), [conversationKey]);
  const initializedVisitRef = useRef<object | null>(null);
  const activeVisitRef = useRef<object | null>(null);
  const readyRef = useRef(false);
  const isStuckRef = useRef(false);
  const detachedRef = useRef(false);
  const navigationFollowRef = useRef(false);
  const lastScrollTopRef = useRef(-1);
  const lastSendRef = useRef<string>();
  const previousKeyRef = useRef<typeof conversationKey>();
  const explicitSendRef = useRef(navigation?.explicitSendId);
  const pendingSendRef = useRef(false);
  const suppressNextResizeFollowRef = useRef(false);
  const cancelGlideRef = useRef<(() => void) | null>(null);

  const cancelGlide = useCallback(() => {
    cancelGlideRef.current?.();
    cancelGlideRef.current = null;
  }, []);

  useLayoutEffect(() => {
    explicitSendRef.current = navigation?.explicitSendId;
  });

  useLayoutEffect(() => {
    activeVisitRef.current = visit;
    // Admission replaces /c/new with the durable id. That is still the same
    // explicit send, including any reader gesture made before admission.
    const promotedSend =
      previousKeyRef.current === Constants.NEW_CONVO &&
      explicitSendRef.current != null &&
      explicitSendRef.current === lastSendRef.current;
    previousKeyRef.current = conversationKey;
    if (initializedVisitRef.current !== visit && !promotedSend) {
      isStuckRef.current = false;
      detachedRef.current = false;
      navigationFollowRef.current = false;
      lastScrollTopRef.current = -1;
      pendingSendRef.current = false;
      suppressNextResizeFollowRef.current = false;
    }
    initializedVisitRef.current = visit;
    return () => {
      activeVisitRef.current = null;
      cancelGlide();
    };
  }, [visit, cancelGlide, conversationKey]);

  useLayoutEffect(() => {
    readyRef.current = ready;
    if (!ready) {
      cancelGlide();
    }
  }, [ready, cancelGlide]);

  const isCurrent = useCallback(() => activeVisitRef.current === visit, [visit]);
  const distanceFromEnd = useCallback(() => {
    const el = scrollableRef.current;
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  }, []);

  const detach = useCallback(() => {
    if (!isCurrent()) {
      return;
    }
    detachedRef.current = true;
    isStuckRef.current = false;
    pendingSendRef.current = false;
    cancelGlide();
  }, [cancelGlide, isCurrent]);

  /** Direct measurement includes padding and content mounted after the sentinel's
   * first commit. No throttled callback can re-attach a later visit or gesture. */
  const followBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = scrollableRef.current;
      if (!isCurrent() || !readyRef.current || !el || el.clientHeight === 0) {
        return;
      }
      const target = Math.max(0, el.scrollHeight - el.clientHeight);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (behavior !== 'smooth' || reducedMotion || Math.abs(el.scrollTop - target) < 1) {
        el.scrollTop = target;
        lastScrollTopRef.current = el.scrollTop;
        return;
      }

      cancelGlide();
      const cancel = () => {
        clearTimeout(timer);
        el.removeEventListener('scrollend', land);
        // Stop the browser's animation as well as its completion callback.
        el.scrollTo({ top: el.scrollTop, behavior: 'instant' });
      };
      const land = () => {
        if (cancelGlideRef.current !== cancel) {
          return;
        }
        cancelGlideRef.current = null;
        clearTimeout(timer);
        el.removeEventListener('scrollend', land);
        if (!isCurrent() || !readyRef.current || !isStuckRef.current) {
          return;
        }
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        lastScrollTopRef.current = el.scrollTop;
      };
      cancelGlideRef.current = cancel;
      el.addEventListener('scrollend', land);
      const timer = setTimeout(land, glideTimeout);
      lastScrollTopRef.current = el.scrollTop;
      el.scrollTo({ top: target, behavior: 'smooth' });
    },
    [cancelGlide, isCurrent],
  );

  const scrollToBottom = useCallback(() => {
    if (!isCurrent() || !readyRef.current) {
      return;
    }
    cancelGlide();
    detachedRef.current = false;
    isStuckRef.current = true;
    followBottom();
    reconcileMessageContentLayout(scrollableRef.current);
  }, [cancelGlide, followBottom, isCurrent]);

  const handleSmoothToRef: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.preventDefault();
      if (!isCurrent() || !readyRef.current) {
        return;
      }
      detachedRef.current = false;
      isStuckRef.current = true;
      suppressNextResizeFollowRef.current = false;
      setAbortScroll(false);
      followBottom('smooth');
    },
    [followBottom, isCurrent, setAbortScroll],
  );

  const debouncedHandleScroll = useCallback(() => {
    const el = scrollableRef.current;
    if (!isCurrent() || !el) {
      return;
    }
    const previous = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (previous < 0) {
      return;
    }
    const distance = distanceFromEnd();
    if (el.scrollTop < previous) {
      detach();
    } else if (el.scrollTop > previous && distance <= attachThreshold) {
      detachedRef.current = false;
      isStuckRef.current = true;
      suppressNextResizeFollowRef.current = false;
      setAbortScroll(false);
    }
  }, [detach, distanceFromEnd, isCurrent, setAbortScroll]);

  // Intersection controls the button, not follow ownership: a growing zero-height
  // sentinel can flicker without any reader movement.
  const handleNearBottomChange = useCallback((_isNearBottom: boolean) => {}, []);

  useLayoutEffect(() => {
    if (!autoScroll) {
      if (navigationFollowRef.current) {
        isStuckRef.current = false;
        cancelGlide();
      }
      navigationFollowRef.current = false;
      return;
    }
    if (!navigationFollowRef.current && !detachedRef.current) {
      navigationFollowRef.current = true;
      isStuckRef.current = true;
    }
  }, [autoScroll, visit, cancelGlide]);

  useLayoutEffect(() => {
    const sendId = navigation?.explicitSendId;
    if (sendId != null && sendId !== lastSendRef.current) {
      lastSendRef.current = sendId;
      pendingSendRef.current = true;
      detachedRef.current = false;
    }
    if (!ready) {
      return;
    }
    if (pendingSendRef.current && isSubmitting && !abortScroll) {
      pendingSendRef.current = false;
      navigationFollowRef.current = false;
      isStuckRef.current = true;
      followBottom('smooth');
    } else if (isStuckRef.current && !cancelGlideRef.current) {
      followBottom();
    }
  }, [
    navigation?.explicitSendId,
    ready,
    isSubmitting,
    abortScroll,
    messagesTree,
    autoScroll,
    followBottom,
  ]);

  useEffect(() => {
    const el = scrollableRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!isCurrent() || !readyRef.current) {
        return;
      }
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop > max) {
        el.scrollTop = max;
        lastScrollTopRef.current = el.scrollTop;
        return;
      }
      if (suppressNextResizeFollowRef.current) {
        suppressNextResizeFollowRef.current = false;
        if (distanceFromEnd() > resizeFollowThreshold) {
          detach();
        }
        return;
      }
      if (
        isStuckRef.current &&
        !cancelGlideRef.current &&
        (isSubmitting || navigationFollowRef.current)
      ) {
        followBottom();
      }
    });
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, [detach, distanceFromEnd, followBottom, isCurrent, isSubmitting]);

  useEffect(() => {
    const el = scrollableRef.current;
    const content = contentRef.current;
    if (!el || !content) {
      return;
    }
    let frame: number | undefined;
    let touchY: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        detach();
      } else if (event.deltaY > 0) {
        // The message's bubbling wheel handler raises abortScroll after this one.
        if (frame != null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (isCurrent()) setAbortScroll(false);
        });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)
      ) {
        detach();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next != null && touchY != null && next > touchY) detach();
      touchY = next;
    };
    const remember = () => {
      lastScrollTopRef.current = el.scrollTop;
    };
    const suppress = () => {
      suppressNextResizeFollowRef.current = true;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('pointerdown', remember);
    content.addEventListener('pointerdown', suppress, true);
    content.addEventListener('keydown', suppress, true);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('pointerdown', remember);
      content.removeEventListener('pointerdown', suppress, true);
      content.removeEventListener('keydown', suppress, true);
    };
  }, [detach, isCurrent, setAbortScroll]);

  return {
    conversation,
    contentRef,
    scrollableRef,
    messagesEndRef,
    scrollToBottom,
    handleSmoothToRef,
    debouncedHandleScroll,
    handleNearBottomChange,
  };
}
