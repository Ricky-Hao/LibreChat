import { TooltipAnchor, Button, Sidebar } from '@librechat/client';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import { useLocalize } from '~/hooks';

export const CLOSE_SIDEBAR_ID = 'close-sidebar-button';
export const OPEN_SIDEBAR_ID = 'open-sidebar-button';

/**
 * `testId` exists because the sidebar rail publishes `open-sidebar-button` for its own
 * collapsed toggle. Any caller that can stay mounted alongside the rail must claim a
 * distinct id, or `getByTestId` resolves to two elements.
 */
export default function OpenSidebar({
  className,
  testId = OPEN_SIDEBAR_ID,
}: {
  className?: string;
  testId?: string;
}) {
  const localize = useLocalize();
  const { setSidebarOpen } = useSidebarToggle();
  const tooltipDescription = useShortcutHint('toggleSidebar', localize('com_nav_open_sidebar'));
  const ariaKey = useShortcutAriaKey('toggleSidebar');

  const handleClick = () => {
    const opener = document.activeElement;
    const mode = setSidebarOpen(true);
    if (mode === 'none') {
      /** Desktop panels need a timed handoff. The animator can also be absent
       * during mobile initialization, so preserve its commit-driven handoff
       * and any deliberate focus change before this fallback runs. */
      setTimeout(() => {
        if (document.activeElement === opener || document.activeElement === document.body) {
          document.getElementById(CLOSE_SIDEBAR_ID)?.focus();
        }
      }, 250);
    }
  };

  return (
    <TooltipAnchor
      description={tooltipDescription}
      render={
        <Button
          id={OPEN_SIDEBAR_ID}
          size="icon"
          variant="header-action"
          data-testid={testId}
          aria-label={localize('com_nav_open_sidebar')}
          aria-expanded={false}
          aria-controls="chat-history-nav"
          aria-keyshortcuts={ariaKey}
          className={className}
          onClick={handleClick}
        >
          <Sidebar className="icon-md" aria-hidden="true" />
        </Button>
      }
    />
  );
}
