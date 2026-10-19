import { Alert, Button } from '@librechat/client';
import { findMessageById } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useHistoryParentQuery } from '~/data-provider/Messages/queries';
import { findRerunParent } from './rerunParent';
import { useLocalize } from '~/hooks';

export function useRerunParent(
  messages: TMessage[] | null | undefined,
  conversationId: string | null | undefined,
  parentMessageId?: string | null,
) {
  const query = useHistoryParentQuery(
    conversationId ?? '',
    parentMessageId,
    findMessageById(messages, parentMessageId) == null,
  );
  const parent =
    findRerunParent(messages, parentMessageId) ??
    (query.data?.isCreatedByUser === true ? query.data : undefined);
  return { parent, query };
}

export function ParentError({ error, retry }: { error: boolean; retry: () => void }) {
  const localize = useLocalize();
  if (!error) return null;
  return (
    <Alert variant="error">
      {localize('com_ui_history_parent_error')}
      <Button type="button" variant="ghost" size="sm" onClick={retry}>
        {localize('com_ui_retry')}
      </Button>
    </Alert>
  );
}
