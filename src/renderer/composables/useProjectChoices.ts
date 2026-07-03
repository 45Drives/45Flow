// src/composables/useProjectChoices.ts
import { ref, computed, type Ref } from 'vue'
import { useApi } from './useApi'

type Root = { name: string; mountpoint: string }
type DirEntry = { name: string; path: string }

// ---- module-level caches (shared across component instances)
let zfsRootsCache: { ts: number; roots: Root[] } | null = null
const ZFS_ROOTS_TTL = 30_000 // ms – refetch pools after 30 s
const dirCache = new Map<string, { ts: number; entries: DirEntry[] }>()
const DIR_TTL = 5000 // ms

export function useProjectChoices(showEntireTree: Ref<boolean>) {
    const { apiFetch } = useApi()

    // state
    const detecting = ref(false)
    const detectingRoots = ref(false)   // true only while fetching ZFS roots
    const detectError = ref<string | null>(null)
    const projectRoots = ref<Root[]>([])
    const projectDirs = ref<DirEntry[]>([])
    const browseMode = ref<'roots' | 'dir'>('roots')
    const currentRoot = ref<string>('')   // active root mountpoint (when restricted)
    const browsePath = ref<string>('')   // current directory path
    const forceProjectRoot = ref(false)
    const configuredProjectRoot = ref('')
    const useConfiguredProjectRoot = ref(false)
    const hasConfiguredProjectRoot = computed(() => !!configuredProjectRoot.value)
    let configuredToggleInitialized = false

    // derived
    const canGoUp = computed(() => {
        if (showEntireTree.value) return browsePath.value !== '/'
        if (!currentRoot.value) return false
        return browsePath.value !== currentRoot.value
    })

    // debounce holder
    let listTimer: ReturnType<typeof setTimeout> | null = null

    // List directories for any absolute path with small debounce & caching
    async function listDirs(base: string) {
        if (listTimer) clearTimeout(listTimer)
        detecting.value = true

        await new Promise<void>(resolve => {
            listTimer = setTimeout(() => resolve(), 120)
        })

        try {
            const now = Date.now()
            const cacheKey = (showEntireTree.value ? 'R:' : '') + base
            const cached = dirCache.get(cacheKey)
            if (cached && (now - cached.ts) < DIR_TTL) {
                projectDirs.value = cached.entries
                return
            }

            const fromRoot = showEntireTree.value ? '&fromRoot=1' : ''
            const data = await apiFetch(`/api/files?dir=${encodeURIComponent(base)}&dirsOnly=1${fromRoot}`)
            const root = base.endsWith('/') ? base : base + '/'
            const entries: DirEntry[] = (data.entries || [])
                .filter((e: any) => e.isDir)
                .map((e: any) => ({ name: e.name, path: root + e.name }))
                .sort((a: any, b: any) => a.name.localeCompare(b.name))

            projectDirs.value = entries
            dirCache.set(cacheKey, { ts: now, entries })
        } catch {
            projectDirs.value = []
            detectError.value = 'Unable to load directories.'
        } finally {
            detecting.value = false
        }
    }

    function backToRoots() {
        if (!showEntireTree.value && useConfiguredProjectRoot.value && configuredProjectRoot.value) {
            browseMode.value = 'dir'
            currentRoot.value = configuredProjectRoot.value
            browsePath.value = configuredProjectRoot.value
            listDirs(configuredProjectRoot.value)
            return
        }
        browseMode.value = 'roots'
        currentRoot.value = ''
        browsePath.value = ''
        projectDirs.value = []
    }

    function goUp() {
        if (!browsePath.value || browsePath.value === '/') return
        const up = browsePath.value.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
        if (!showEntireTree.value && currentRoot.value && !up.startsWith(currentRoot.value)) {
            browsePath.value = currentRoot.value
        } else {
            browsePath.value = up
        }
        listDirs(browsePath.value)
    }

    function drillInto(p: string) {
        browsePath.value = p
        listDirs(p)
    }

    function openRoot(r: Root) {
        currentRoot.value = r.mountpoint
        browsePath.value = r.mountpoint
        browseMode.value = 'dir'
        listDirs(r.mountpoint)
    }

    /**
     * Main entry: load either ZFS roots or '/' depending on showEntireTree
     * Calls on mount and whenever the checkbox changes.
     */
    async function loadProjectChoices() {
        detecting.value = true
        detectError.value = null
        projectDirs.value = []
        projectRoots.value = []
        currentRoot.value = ''
        browsePath.value = ''

        try {
            try {
                const settings = await apiFetch('/api/settings', { method: 'GET' })
                forceProjectRoot.value = !!settings?.forceProjectRoot
                if (typeof settings?.projectRoot === 'string') {
                    let root = String(settings.projectRoot).trim().replace(/\\/g, '/')
                    if (root && !root.startsWith('/')) root = `/${root}`
                    root = root.replace(/\/+$/, '') || '/'
                    configuredProjectRoot.value = root
                } else {
                    configuredProjectRoot.value = ''
                }
                if (!configuredToggleInitialized) {
                    useConfiguredProjectRoot.value = !!configuredProjectRoot.value
                    configuredToggleInitialized = true
                } else if (!configuredProjectRoot.value) {
                    useConfiguredProjectRoot.value = false
                }
            } catch {
                forceProjectRoot.value = false
                configuredProjectRoot.value = ''
                useConfiguredProjectRoot.value = false
            }

            if (showEntireTree.value) {
                browseMode.value = 'dir'
                await listDirs('/')
                return
            }

            if (useConfiguredProjectRoot.value && configuredProjectRoot.value) {
                browseMode.value = 'dir'
                currentRoot.value = configuredProjectRoot.value
                browsePath.value = configuredProjectRoot.value
                await listDirs(configuredProjectRoot.value)
                return
            }

            // serve from cache if still fresh
            const now = Date.now()
            if (zfsRootsCache && (now - zfsRootsCache.ts) < ZFS_ROOTS_TTL && zfsRootsCache.roots.length > 0) {
                projectRoots.value = zfsRootsCache.roots
                browseMode.value = 'roots'
                return
            }

            detectingRoots.value = true
            const rootsUrl = (!useConfiguredProjectRoot.value && forceProjectRoot.value)
                ? '/api/zfs/roots?ignoreConfiguredRoot=1'
                : '/api/zfs/roots'
            const roots = await apiFetch(rootsUrl).catch(() => [])
            projectRoots.value = Array.isArray(roots) ? roots : []
            if (projectRoots.value.length > 0) {
                zfsRootsCache = { ts: Date.now(), roots: projectRoots.value }
            } else {
                zfsRootsCache = null           // don't cache empty – retry next time
            }
            detectingRoots.value = false
            browseMode.value = 'roots'
        } catch {
            detectError.value = 'ZFS detection failed; showing system root.'
            browseMode.value = 'dir'
            await listDirs('/')
        } finally {
            detecting.value = false
            detectingRoots.value = false
        }
    }

    return {
        // state/derived
        detecting, detectingRoots, detectError, projectRoots, projectDirs,
        browseMode, currentRoot, browsePath, canGoUp,
        forceProjectRoot, configuredProjectRoot, useConfiguredProjectRoot, hasConfiguredProjectRoot,
        // actions
        listDirs, backToRoots, goUp, drillInto, openRoot, loadProjectChoices,
    }
}
