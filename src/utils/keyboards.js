import { Markup } from 'telegraf';

import { pack } from './callbacks.js';

export function paginate(items, page, perPage = 8) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * perPage;
  return {
    page: safePage,
    totalPages,
    slice: items.slice(start, start + perPage),
  };
}

export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

/**
 * Builds a paginated inline keyboard from a list of entries shaped like
 * `{ text, callback_data }`. Adds nav row and optional extra rows.
 */
export function paginatedKeyboard({
  items,
  page = 0,
  perPage = 8,
  perRow = 1,
  navCallbackPrefix,
  extraRows = [],
}) {
  const { slice, page: safePage, totalPages } = paginate(items, page, perPage);
  const rows = chunk(slice, perRow).map((row) =>
    row.map((b) => Markup.button.callback(b.text, b.callback_data)),
  );

  if (totalPages > 1) {
    const navRow = [];
    navRow.push(
      Markup.button.callback(
        safePage > 0 ? '« Prev' : '·',
        safePage > 0 ? pack(navCallbackPrefix, 'page', safePage - 1) : 'noop',
      ),
    );
    navRow.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, 'noop'));
    navRow.push(
      Markup.button.callback(
        safePage < totalPages - 1 ? 'Next »' : '·',
        safePage < totalPages - 1 ? pack(navCallbackPrefix, 'page', safePage + 1) : 'noop',
      ),
    );
    rows.push(navRow);
  }

  for (const row of extraRows) rows.push(row);
  return Markup.inlineKeyboard(rows);
}
