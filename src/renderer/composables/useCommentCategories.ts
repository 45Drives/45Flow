// src/renderer/composables/useCommentCategories.ts
import { computed, reactive, ref } from 'vue';
import { useApi } from './useApi';

export interface CommentCategory {
  id: number;
  link_id: number;
  name: string;
  color: string | null;
  created_by?: number | null;
  created_at?: string;
}

const defaultCategories = [
  { name: 'Bug / Issue', color: '#FF6B6B' },
  { name: 'Feedback', color: '#4ECDC4' },
  { name: 'Question', color: '#FFE66D' },
  { name: 'Follow-up', color: '#95E1D3' },
  { name: 'Review', color: '#AA96DA' },
  { name: 'Approved', color: '#FCBAD3' },
];

interface CategoryState {
  [linkId: number]: CommentCategory[];
}

const categoryCache = reactive<CategoryState>({});
const isLoadingCategories = ref(false);

export function useCommentCategories() {
  const { apiFetch } = useApi();

  /**
   * Get all categories for a link (cached)
   */
  async function getCategoriesForLink(token: string, linkId: number) {
    // Always hand back a copy — callers must not observe later cache mutations.
    if (categoryCache[linkId]) {
      return [...categoryCache[linkId]];
    }

    isLoadingCategories.value = true;
    try {
      const res = await apiFetch(`/api/token/${encodeURIComponent(token)}/links/${linkId}/categories`);
      if (res?.ok && res.categories) {
        categoryCache[linkId] = res.categories;
        return [...res.categories];
      }
      return [];
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      return [];
    } finally {
      isLoadingCategories.value = false;
    }
  }

  /**
   * Create a new comment category
   */
  async function createCategory(
    token: string,
    linkId: number,
    name: string,
    color?: string | null
  ): Promise<CommentCategory | null> {
    try {
      const res = await apiFetch(`/api/token/${encodeURIComponent(token)}/links/${linkId}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name, color: color || null }),
      });

      if (res?.ok && res.category) {
        // Update cache
        if (!categoryCache[linkId]) {
          categoryCache[linkId] = [];
        }
        categoryCache[linkId].push(res.category);
        return res.category;
      }
      return null;
    } catch (err) {
      console.error('Failed to create category:', err);
      throw err;
    }
  }

  /**
   * Update an existing category
   */
  async function updateCategory(
    token: string,
    categoryId: number,
    name?: string,
    color?: string
  ): Promise<CommentCategory | null> {
    try {
      const res = await apiFetch(`/api/token/${encodeURIComponent(token)}/categories/${categoryId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, color }),
      });

      if (res?.ok && res.category) {
        // Update all cache entries
        for (const linkId in categoryCache) {
          const idx = categoryCache[linkId].findIndex((c) => c.id === categoryId);
          if (idx >= 0) {
            categoryCache[linkId][idx] = res.category;
          }
        }
        return res.category;
      }
      return null;
    } catch (err) {
      console.error('Failed to update category:', err);
      return null;
    }
  }

  /**
   * Delete a category
   */
  async function deleteCategory(token: string, categoryId: number): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/token/${encodeURIComponent(token)}/categories/${categoryId}`, {
        method: 'DELETE',
      });
      if (res?.ok) {
        // Remove from all cache entries
        for (const linkId in categoryCache) {
          const idx = categoryCache[linkId].findIndex((c) => c.id === categoryId);
          if (idx >= 0) {
            categoryCache[linkId].splice(idx, 1);
          }
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to delete category:', err);
      return false;
    }
  }

  /**
   * Get default category suggestions
   */
  function getDefaultCategories(): Array<{ name: string; color: string }> {
    return defaultCategories;
  }

  /**
   * Clear category cache (useful for link refresh)
   */
  function clearCategoryCache(linkId?: number) {
    if (linkId !== undefined) {
      delete categoryCache[linkId];
    } else {
      for (const key in categoryCache) {
        delete categoryCache[key];
      }
    }
  }

  /**
   * Initialize categories for a link with defaults if it's new
   */
  async function initializeDefaultCategories(token: string, linkId: number) {
    const existing = await getCategoriesForLink(token, linkId);
    if (existing.length === 0) {
      // Create default categories
      for (const defaultCat of defaultCategories) {
        await createCategory(token, linkId, defaultCat.name, defaultCat.color);
      }
    }
  }

  const currentCategories = computed(() => {
    // Return empty array if not loaded
    return Object.values(categoryCache).flat();
  });

  return {
    // Data
    currentCategories,
    isLoadingCategories,

    // Methods
    getCategoriesForLink,
    createCategory,
    updateCategory,
    deleteCategory,
    getDefaultCategories,
    clearCategoryCache,
    initializeDefaultCategories,
  };
}
