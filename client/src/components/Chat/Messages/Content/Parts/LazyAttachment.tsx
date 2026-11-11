import { useId, useState } from 'react';
import { Button } from '@librechat/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { TAttachment, TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { fetchFilePreview, previewRefetchInterval } from '~/data-provider/Files/queries';
import { displayFilename } from './attachmentTypes';
import { useAttachmentLink } from './LogLink';
import { isNotFoundError } from '~/utils';
import { useLocalize } from '~/hooks';

/** An explicit disclosure owns body fetching. Fetched text never enters the history cache. */
export default function LazyAttachment({
  attachment,
  children,
}: {
  attachment: TAttachment;
  children: (attachment: TAttachment) => ReactNode;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = attachment.bodyRef;
  const client = useQueryClient();
  const file = attachment as Partial<TFile>;
  const query = useQuery(
    [QueryKeys.attachmentBody, ref?.conversationId, ref?.messageId, ref?.index, ref?.revision],
    async () => {
      if (!ref) throw new Error('Missing attachment reference');
      if (file.file_id) {
        try {
          const preview = await fetchFilePreview(file.file_id);
          if (preview.status !== 'ready' || preview.text != null) return preview;
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }
      return {
        ...(await dataService.getAttachmentBody(ref)),
        file_id: file.file_id ?? '',
        status: 'ready' as const,
      };
    },
    {
      enabled: open && ref != null,
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      onError: (error) => {
        if (ref && isNotFoundError(error))
          void client.invalidateQueries([QueryKeys.messages, ref.conversationId]);
      },
      refetchInterval: (data) =>
        open && data?.status === 'pending'
          ? previewRefetchInterval(data, { queryKey: [QueryKeys.filePreview, file.file_id] })
          : false,
    },
  );
  const { handleDownload } = useAttachmentLink({
    href: attachment.filepath ?? '',
    filename: attachment.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });
  const ready = open && query.data?.status === 'ready';
  const failed = open && (query.isError || query.data?.status === 'failed');
  const loading = open && !ready && !failed;
  const filename = displayFilename(attachment.filename) || localize('com_ui_file');
  let label: TranslationKeys = open ? 'com_ui_hide' : 'com_ui_preview';
  if (loading) label = 'com_ui_loading';
  if (failed) label = 'com_ui_retry';
  return (
    <div
      className="border-border-light my-2 rounded-lg border p-3"
      role="group"
      aria-label={filename}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm" title={filename}>
          {filename}
        </span>
        {file.bytes != null && (
          <span className="text-text-secondary text-xs">{file.bytes.toLocaleString()} B</span>
        )}
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          aria-busy={loading}
          onClick={() => {
            if (failed) {
              void query.refetch();
              return;
            }
            setOpen((value) => !value);
          }}
        >
          {localize(label)}
        </Button>
        {attachment.filepath && (
          <Button
            variant="ghost"
            onClick={handleDownload}
            aria-label={`${localize('com_ui_download')} ${filename}`}
          >
            {localize('com_ui_download')}
          </Button>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-text-secondary text-sm">
          {localize('com_ui_preview_failed')}
        </p>
      )}
      <div id={panelId} hidden={!ready}>
        {ready && children({ ...attachment, ...query.data, bodyRef: undefined })}
      </div>
    </div>
  );
}
