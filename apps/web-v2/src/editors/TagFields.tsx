import type { ItemSynonym } from '@dnd/shared';
import { useState } from 'react';
import { CategoryField } from '../components/Categories';
import { SynonymsField } from '../components/SynonymsField';

/**
 * The user's own synonyms and categories on an item, as an editor edits them. Every user
 * who has the item may change these, owner or not; `body` is what to send.
 */
export function useTagsDraft(item: { synonyms: ItemSynonym[]; categoryIds: string[] } | null) {
  const [synonyms, setSynonyms] = useState(
    () => item?.synonyms.filter((s) => s.mine).map((s) => s.label) ?? [],
  );
  const [categoryIds, setCategoryIds] = useState(item?.categoryIds ?? []);
  return {
    synonyms,
    setSynonyms,
    categoryIds,
    setCategoryIds,
    /** The owner's synonyms, when someone else owns the item. */
    others: item?.synonyms.filter((s) => !s.mine).map((s) => s.label) ?? [],
    body: { synonyms, categoryIds },
  };
}

export function TagFields({
  draft,
  ownerName,
  errors,
}: {
  draft: ReturnType<typeof useTagsDraft>;
  /** Shown on the owner's synonyms of a shared item. */
  ownerName?: string;
  errors?: Record<string, string>;
}) {
  return (
    <>
      <SynonymsField
        mine={draft.synonyms}
        others={draft.others}
        othersBy={ownerName}
        onChange={draft.setSynonyms}
        error={errors?.synonyms}
      />
      <CategoryField value={draft.categoryIds} onChange={draft.setCategoryIds} />
    </>
  );
}
