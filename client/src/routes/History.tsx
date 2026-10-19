import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import { DEFAULT_HISTORY_WINDOW_SIZE } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { HistoryWindowContext } from '~/Providers/HistoryWindowContext';
import { autoScrollAtom } from '~/store/autoScroll';

export default function History({
  size = DEFAULT_HISTORY_WINDOW_SIZE,
  children,
}: {
  size?: number;
  children: ReactNode;
}) {
  const autoScroll = useAtomValue(autoScrollAtom);
  const location = useLocation();
  const targeted = location.hash !== '' || new URLSearchParams(location.search).has('messageId');
  return (
    <HistoryWindowContext.Provider value={autoScroll && !targeted ? size : 0}>
      {children}
    </HistoryWindowContext.Provider>
  );
}
