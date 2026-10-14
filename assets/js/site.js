(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const fmtNum = (n) => n == null ? '–' : Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);

  const toggle = $('.nav-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    document.body.classList.toggle('nav-open', !open);
  });

  const videoCard = (v, big = false) => `
    <a class="video-card${big ? ' video-card-big' : ''}" href="${esc(v.url)}" target="_blank" rel="noopener">
      <span class="thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="play" aria-hidden="true"></span></span>
      <span class="video-meta">
        <span class="video-title">${esc(v.title)}</span>
        <span class="video-sub">${fmtDate(v.published)}${v.views ? ` · ${fmtNum(v.views)} views` : ''}</span>
      </span>
    </a>`;

  const empty = (msg) => `<p class="empty">${esc(msg)}</p>`;

  const seriesCard = (s, data) => {
    const latest = s.videos?.[0];
    const modCount = s.modIds?.length || 0;
    return `
      <a class="series-card" href="/series#${esc(s.slug)}">
        <span class="series-thumb">${latest ? `<img src="${esc(latest.thumb)}" alt="" loading="lazy">` : ''}</span>
        <span class="series-body">
          <span class="badge ${s.status.toLowerCase() === 'active' ? 'badge-live' : ''}">${esc(s.status)}</span>
          <span class="series-name">${esc(s.name)}</span>
          <span class="video-sub">${s.videos?.length || 0} episodes · ${modCount} mods</span>
        </span>
      </a>`;
  };

  const renderers = {
    home(data) {
      const vids = data.videos || [];
      $('[data-latest]').innerHTML = vids[0] ? videoCard(vids[0], true) : empty('New videos will show up here automatically.');
      $('[data-recent]').innerHTML = vids.slice(1, 7).map((v) => videoCard(v)).join('') || '';
      const active = (data.series || []).filter((s) => s.status.toLowerCase() !== 'complete');
      $('[data-series-strip]').innerHTML = (active.length ? active : data.series || []).map((s) => seriesCard(s, data)).join('') || empty('Series will appear once the sheet is connected.');
      const stats = $('[data-stats]');
      if (data.series?.length || data.discord?.members) {
        stats.hidden = false;
        $('[data-stat="series"]').textContent = fmtNum(data.series?.length || 0);
        $('[data-stat="mods"]').textContent = fmtNum(data.mods?.length || 0);
        $('[data-stat="members"]').textContent = fmtNum(data.discord?.members);
      }
    },

    series(data) {
      const list = $('[data-series-list]');
      const modsById = Object.fromEntries((data.mods || []).map((m) => [m.id, m]));
      list.innerHTML = (data.series || []).map((s) => `
        <article class="series-block" id="${esc(s.slug)}">
          <header class="series-block-head">
            <div>
              <span class="badge ${s.status.toLowerCase() === 'active' ? 'badge-live' : ''}">${esc(s.status)}</span>
              <h2>${esc(s.name)}</h2>
              ${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}
            </div>
            <div class="series-actions">
              ${s.playlistUrl ? `<a class="btn btn-sm btn-primary" href="${esc(s.playlistUrl)}" target="_blank" rel="noopener">Full playlist</a>` : ''}
              <a class="btn btn-sm btn-ghost" href="/mods?series=${esc(s.slug)}">${s.modIds?.length || 0} mods</a>
            </div>
          </header>
          <div class="video-grid video-grid-sm">${(s.videos || []).slice(0, 8).map((v) => videoCard(v)).join('') || empty('Episodes will appear here once the playlist has videos.')}</div>
          ${s.modIds?.length ? `<p class="mod-peek"><span>Running:</span> ${s.modIds.slice(0, 8).map((id) => esc(modsById[id]?.name || '')).filter(Boolean).join(', ')}${s.modIds.length > 8 ? ` and ${s.modIds.length - 8} more` : ''}</p>` : ''}
        </article>`).join('') || empty('Series will appear once the Google Sheet is connected.');
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    },

    mods(data) {
      const series = data.series || [];
      const mods = data.mods || [];
      const params = new URLSearchParams(location.search);
      let current = series.some((s) => s.slug === params.get('series')) ? params.get('series') : 'all';
      const chips = $('[data-chips]');
      const search = $('[data-search]');
      const grid = $('[data-mods]');
      const count = $('[data-count]');
      const nameOf = Object.fromEntries(series.map((s) => [s.slug, s.name]));

      chips.innerHTML = [{ slug: 'all', name: 'All series' }, ...series].map((s) =>
        `<button type="button" class="chip" data-slug="${esc(s.slug)}">${esc(s.name)}</button>`).join('');

      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const shown = mods.filter((m) => (current === 'all' || m.series.includes(current)) &&
          (!q || `${m.name} ${m.author}`.toLowerCase().includes(q)));
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.slug === current)));
        count.textContent = mods.length ? `${shown.length} of ${mods.length} mods` : '';
        grid.innerHTML = shown.map((m) => {
          const note = current !== 'all' ? m.notes?.[current] : Object.values(m.notes || {})[0];
          return `
          <a class="mod-card" href="${esc(m.url)}" target="_blank" rel="noopener">
            <span class="mod-thumb">${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy">` : `<span class="mod-initial">${esc((m.name || '?')[0])}</span>`}</span>
            <span class="mod-body">
              <span class="mod-name">${esc(m.name)}</span>
              ${m.author ? `<span class="video-sub">by ${esc(m.author)}</span>` : ''}
              ${note ? `<span class="mod-note">${esc(note)}</span>` : ''}
              <span class="tag-row">${m.series.map((sl) => `<span class="tag">${esc(nameOf[sl] || sl)}</span>`).join('')}</span>
            </span>
          </a>`;
        }).join('') || empty(mods.length ? 'No mods match that search.' : 'The mod list will appear once the Google Sheet is connected.');
      };

      chips.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        current = b.dataset.slug;
        const url = new URL(location.href);
        if (current === 'all') url.searchParams.delete('series'); else url.searchParams.set('series', current);
        history.replaceState(null, '', url);
        draw();
      });
      search.addEventListener('input', draw);
      draw();
    },

    community(data) {
      const d = data.discord || {};
      if (d.name) $('[data-discord-name]').textContent = d.name;
      if (d.members != null) $('[data-discord-counts]').textContent = `${fmtNum(d.members)} members · ${fmtNum(d.online)} online`;
      if (d.icon) $('[data-discord-icon]').innerHTML = `<img src="${esc(d.icon)}" alt="">`;
    },

    support(data) {
      if (!data.patreonUrl) return;
      const link = $('[data-patreon-link]');
      link.href = data.patreonUrl;
      link.hidden = false;
      $('[data-patreon] .badge').remove();
    }
  };

  const page = document.body.dataset.page;
  fetch('/data/site-data.json', { cache: 'no-cache' })
    .then((r) => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then((data) => {
      renderers[page]?.(data);
      const synced = $('[data-synced]');
      if (synced && data.generatedAt) synced.textContent = `Updated ${fmtDate(data.generatedAt)}.`;
    });
})();
