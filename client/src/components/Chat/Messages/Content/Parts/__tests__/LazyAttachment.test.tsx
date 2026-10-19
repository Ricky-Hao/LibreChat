import { dataService } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TAttachment, TFile } from 'librechat-data-provider';
import LazyAttachment from '../LazyAttachment';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../LogLink', () => ({ useAttachmentLink: () => ({ handleDownload: jest.fn() }) }));
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

const attachment = {
  filename: 'synthetic.txt',
  filepath: '/synthetic.txt',
  bytes: 250_000,
  bodyRef: { conversationId: 'chat', messageId: 'reply', index: 0, revision: 'v1' },
} as TAttachment;
function mount(file = attachment) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, cacheTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <LazyAttachment attachment={file}>
        {(resolved) => <pre>{(resolved as TFile).text}</pre>}
      </LazyAttachment>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

test('does not fetch on mount; shows loading and caches the body across close and reopen', async () => {
  let finish!: (value: { text: string }) => void;
  const fetch = jest.spyOn(dataService, 'getAttachmentBody').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { client } = mount();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText('synthetic.txt')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_preview' }));
  expect(screen.getByRole('button', { name: 'com_ui_loading' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  finish({ text: 'Complete synthetic attachment text' });
  await screen.findByText('Complete synthetic attachment text');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_hide' }));
  expect(screen.queryByText('Complete synthetic attachment text')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_preview' }));
  await screen.findByText('Complete synthetic attachment text');
  expect(fetch).toHaveBeenCalledTimes(1);
  client.clear();
});

test('shows a safe error and retries on request', async () => {
  const fetch = jest
    .spyOn(dataService, 'getAttachmentBody')
    .mockRejectedValue(new Error('private backend diagnostic'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const { client } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_preview_failed');
  expect(screen.queryByText('private backend diagnostic')).not.toBeInTheDocument();
  fetch.mockResolvedValue({ text: 'Recovered complete text' });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  await screen.findByText('Recovered complete text');
  expect(fetch).toHaveBeenCalledTimes(3);
  consoleError.mockRestore();
  client.clear();
});

test('uses the authorized file preview endpoint after open and keeps heavy text out of history', async () => {
  const preview = jest.spyOn(dataService, 'getFilePreview').mockResolvedValue({
    file_id: 'file',
    status: 'ready',
    text: 'Canonical file text',
    textFormat: 'text',
  });
  const embedded = jest.spyOn(dataService, 'getAttachmentBody');
  const { client } = mount({ ...attachment, file_id: 'file' } as TAttachment);
  expect(preview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_preview' }));
  await screen.findByText('Canonical file text');
  expect(preview).toHaveBeenCalledWith('file');
  expect(embedded).not.toHaveBeenCalled();
  expect(client.getQueryData(['messages', 'chat'])).toBeUndefined();
  client.clear();
});
