
    // Audit N-2: escape every dynamic string before innerHTML injection.
    // Channel names come from the BEXT field of client WAV files — fully
    // attacker-controlled bytes. This helper is the single gate.
    function esc(str) {
      var s = (str === null || str === undefined) ? '' : String(str);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  // ===== Electron IPC Bridge =====
  var eIPC = window.electronAPI || null;
  var _tabSwitchEpoch = 0;  // bumped on every switchTab; stale timers bail out

  function minimizeWindow() { if (eIPC && eIPC.minimizeWindow) eIPC.minimizeWindow(); }
  function maximizeWindow() {
    if (eIPC && eIPC.maximizeWindow) eIPC.maximizeWindow();
  }
  function closeWindow() { if (eIPC && eIPC.closeWindow) eIPC.closeWindow(); }

  // ===== Tab switching =====
  function switchTab(name) {
    var tabs = document.querySelectorAll('.tab-bar .tab');
    var contents = document.querySelectorAll('.tab-content');
    var newTab = document.getElementById('tab-' + name);
    if (!newTab) return;

    tabs.forEach(function(t) {
      var active = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', active);
      // ARIA tab pattern: selected state lives on the role=tab button
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.tabIndex = active ? 0 : -1;
    });

    // Panels: aria-hidden tracks visibility for assistive tech
    contents.forEach(function(c) {
      c.setAttribute('aria-hidden', c === newTab ? 'false' : 'true');
    });

    // Fade out the current visible tab, then fade in the new one.
    // Epoch token guards against A->B->A races: a delayed hide for an old
    // switch must not blank the tab that became active again meanwhile.
    var current = document.querySelector('.tab-content.active');
    if (current && current !== newTab) {
      current.classList.remove('active');
      var switchEpoch = ++_tabSwitchEpoch;
      var elToHide = current;
      setTimeout(function() {
        if (switchEpoch !== _tabSwitchEpoch) return;  // newer switch happened
        if (!elToHide.classList.contains('active')) elToHide.style.display = 'none';
      }, 400);
    }

    if (newTab.style.display === 'none' || !newTab.classList.contains('active')) {
      // Prepare invisible, force reflow, then animate in
      newTab.style.display = 'block';
      newTab.classList.remove('active');
      void newTab.offsetWidth;
      newTab.classList.add('active');
    }

    if (name === 'patch') setTimeout(renderRoutingMap, 60);
        if (name === 'route') setTimeout(renderRouteTab, 60);
        if (name === 'normalize') setTimeout(updateParseTable, 60);
        if (name === 'export') setTimeout(renderExportTab, 60);
    updateEmptyStates();
  }

  function updateEmptyStates() {
    ['normalize', 'route', 'patch', 'export'].forEach(function(tabId) {
      var empty = document.getElementById('empty-' + tabId);
      var content = document.getElementById('tab-' + tabId);
      if (empty && content) {
        var showEmpty = !_fileLoaded && content.classList.contains('active');
        empty.style.display = showEmpty ? '' : 'none';
      }
    });
  }
  document.querySelectorAll('.tab-bar .tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchTab(this.getAttribute('data-tab'));
    });
  });

  // ===== Raw channel data for Normalize tab =====
    var _fileLoaded = false;
    var _filePath = '';
    var _clipName = '';
    var _fileInfo = null;  // Set by handleFile after probe
    var _exporting = false;
    var _exportLog = [];
    var rawChannels = [];  // Populated dynamically by handleFile
    var ROUTING_DATA = []; // Populated dynamically by handleFile

      // Parse a channel name using the user's regex, then smart fallback
        function parseName(raw) {
          if (!raw) return { prefix: '', role: '', num: '', suffix: '' };
          raw = raw.trim();

          // Tier 1: Try the user's regex pattern from the UI (supports named groups)
          var patternEl = document.getElementById('regex-pattern');
          if (patternEl) {
            var pattern = patternEl.value;
            if (pattern) {
              try {
                var re = new RegExp(pattern);
                var m = re.exec(raw);
                if (m && m.groups) {
                  return {
                    prefix: m.groups.prefix || '',
                    role: m.groups.role || '',
                    num: m.groups.num || '',
                    suffix: m.groups.suffix || '',
                  };
                }
              } catch (e) {
                // Bad regex — fall through to smart split
              }
            }
          }

          // Tier 2: Auto-detect separator and smart split
          var sep = null;
          var separators = ['_', ' ', '-', '.'];
          for (var si = 0; si < separators.length; si++) {
            if (raw.indexOf(separators[si]) >= 0) {
              sep = separators[si];
              break;
            }
          }

          if (sep) {
            var parts = raw.split(sep).filter(function(p) { return p.length > 0; });
            if (parts.length === 0) return { prefix: '', role: '', num: '', suffix: '' };

            function isNum(s) { return /^\d+$/.test(s); }
            function isPrefix(s) { return /^[A-Z]{2,4}$/.test(s); }

            var prefix = '';
            var role = '';
            var num = '';
            var suffix = '';
            var remaining = parts.slice();

            // First part as prefix if it looks like one (all-caps, 2-4 chars)
            if (remaining.length > 0 && isPrefix(remaining[0])) {
              prefix = remaining.shift();
            }

            // Last part as number if it looks like one
            if (remaining.length > 0 && isNum(remaining[remaining.length - 1])) {
              num = remaining.pop();
            }

            // Everything in between is the role (rejoined with original separator)
            role = remaining.join(sep);

            return { prefix: prefix, role: role, num: num, suffix: suffix };
          }

          // Tier 3: No separator found — single word like "Host1" or just "Host"
          var m2 = raw.match(/^([A-Z]{2,4})?(\d+)$/);
          if (m2) {
            return { prefix: m2[1] || '', role: '', num: m2[2], suffix: '' };
          }

          // Last resort: treat the whole thing as the role
          return { prefix: '', role: raw, num: '', suffix: '' };
        }

  function applyTemplate(caps, template) {
    var s = template;
    s = s.replace(/{prefix}/g, caps.prefix || '');
    s = s.replace(/{role}/g, caps.role || '');
    s = s.replace(/{type}/g, caps.type || typeLabel(caps.prefix) || '');
    s = s.replace(/{num(?::(0?\d+)d)?}/g, function(match, z) {
      var v = caps.num || '';
      if (z && v) { while (v.length < parseInt(z, 10)) v = '0' + v; }
      return v;
    });
    s = s.replace(/{suffix}/g, caps.suffix || '');
    return s;
  }

  function typeLabel(prefix) {
    var map = { HST: 'Host', BM: 'Boom', LAV: 'Lav', AMB: 'Amb', TC: 'TC', GDE: 'Guide' };
    return map[prefix] || prefix;
  }

  // ===== Normalize tab: column-driven parse table =====
  // Order of this array determines column layout AND output template.
  // Columns where template:true contribute {key} to the auto-generated template.
  var NORM_COLUMNS = [
    { key: 'prefix', label: 'Prefix', width: '80px', template: true },
    { key: 'type', label: 'Type', width: '80px', template: false },
    { key: 'role', label: 'Role', width: '80px', template: true },
    { key: 'num', label: '#', width: '50px', template: true },
    { key: 'suffix', label: 'Suffix', width: '70px', template: false },
  ];

  // Array of template slots (ordered list of {key, label, format?})
  // Auto-synced from NORM_COLUMNS on reorder; manually editable via chips
  var _templateSlots = [];

  function syncTemplateSlots() {
    _templateSlots = [];
    NORM_COLUMNS.forEach(function(c) {
      if (c.template) {
        if (_templateSlots.length > 0) _templateSlots.push({ key: 'sep', text: '_' });
        _templateSlots.push({ key: c.key, label: c.label });
      }
    });
  }

  function buildTemplateString() {
    var parts = [];
    _templateSlots.forEach(function(s) {
      if (s.key === 'sep') {
        parts.push(s.text || '_');
      } else {
        var p = '{' + s.key;
        if (s.format) p += ':' + s.format + 'd';
        p += '}';
        parts.push(p);
      }
    });
    return parts.join('');
  }

  // Render chips into the #template-chips container
  function renderTemplateChips() {
    var container = document.getElementById('template-chips');
    if (!container) return;
    var html = '';
    _templateSlots.forEach(function(s, idx) {
      if (s.key === 'sep') {
        html += '<span class="template-chip-sep">' + esc(s.text || '_') + '</span>';
      } else {
        var label = s.label;
        if (s.format) label += ':' + s.format + 'd';
        html += '<span class="template-chip" data-slot="' + idx + '" role="button" tabindex="0">'
          + label + '<span class="chip-x" data-remove-slot="' + idx + '" role="button" tabindex="-1">&#x2715;</span></span>';
      }
    });
    html += '<span class="template-chip-add" id="chipAddBtn" title="Add template slot" role="button" tabindex="0">+</span>';
    container.innerHTML = html;

    // Sync the hidden template input
    document.getElementById('output-template').value = buildTemplateString();
  }

  // CSP migration: chip interactions are delegated from the #template-chips
  // container (the old generated onclick= attributes were dead under
  // script-src 'self'). Keyboard: Enter/Space activates.
  (function wireTemplateChips() {
    var container = document.getElementById('template-chips');
    if (!container) return;

    function activateChip(chip) {
      if (chip.classList.contains('template-chip-add')) { addChipSlot(); return; }
      var idx = parseInt(chip.getAttribute('data-slot'), 10);
      if (!isNaN(idx)) onChipClick({ stopPropagation: function() {}, currentTarget: chip }, idx);
    }

    container.addEventListener('click', function(e) {
      var rm = e.target.closest('.chip-x');
      if (rm) {
        e.stopPropagation();
        var rIdx = parseInt(rm.getAttribute('data-remove-slot'), 10);
        if (!isNaN(rIdx)) removeChipSlot(rIdx);
        return;
      }
      var chip = e.target.closest('.template-chip, .template-chip-add');
      if (chip) { e.stopPropagation(); activateChip(chip); }
    });

    container.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var chip = e.target.closest('.template-chip, .template-chip-add');
      if (chip && !e.target.closest('.chip-x')) {
        e.preventDefault();
        activateChip(chip);
      }
    });
  })();

  // Close any open chip dropdowns
  function closeChipDropdowns() {
    document.querySelectorAll('.chip-dd.open').forEach(function(el) { el.classList.remove('open'); });
  }

  // Open dropdown for a chip
  var _activeChipIdx = -1;

  function onChipClick(e, idx) {
    e.stopPropagation();
    closeChipDropdowns();
    var chip = e.currentTarget;
    var existing = chip.querySelector('.chip-dd.open');
    if (existing) { existing.classList.remove('open'); return; }

    _activeChipIdx = idx;
    var dd = chip.querySelector('.chip-dd');
    if (dd) { dd.classList.add('open'); return; }

    // Build dropdown
    dd = document.createElement('div');
    dd.className = 'chip-dd open';
    var currentKey = _templateSlots[idx] ? _templateSlots[idx].key : '';

    // Available column keys
    var available = [];
    NORM_COLUMNS.forEach(function(c) {
      available.push({ key: c.key, label: c.label });
    });

    available.forEach(function(a) {
      var item = document.createElement('button');
      item.className = 'chip-dd-item' + (a.key === currentKey ? ' dd-active' : '');
      item.innerHTML = '<span class="dd-label">' + a.label + '</span><span class="dd-hint">' + a.key + '</span>';
      item.onclick = function(e2) { e2.stopPropagation(); selectChipOption(idx, a.key, null); };
      dd.appendChild(item);
    });

    // Format option for num column
    if (currentKey === 'num' || currentKey === '_add') {
      var div = document.createElement('div');
      div.className = 'chip-dd-divider';
      dd.appendChild(div);
      var fmtItem = document.createElement('button');
      var curFmt = _templateSlots[idx] && _templateSlots[idx].format;
      fmtItem.className = 'chip-dd-item' + (curFmt ? ' dd-active' : '');
      fmtItem.innerHTML = '<span class="dd-label">Zero-pad</span><span class="dd-hint">:02d</span>';
      fmtItem.onclick = function(e2) { e2.stopPropagation(); selectChipOption(idx, 'num', curFmt ? null : '02'); };
      dd.appendChild(fmtItem);
    }

    // Remove option
    var div2 = document.createElement('div');
    div2.className = 'chip-dd-divider';
    dd.appendChild(div2);
    var remItem = document.createElement('button');
    remItem.className = 'chip-dd-item';
    remItem.innerHTML = '<span class="dd-label" style="color:var(--tomato);">Remove from template</span>';
    remItem.onclick = function(e2) { e2.stopPropagation(); removeChipSlot(idx); };
    dd.appendChild(remItem);

    chip.appendChild(dd);
  }

  function selectChipOption(idx, key, format) {
    if (!_templateSlots[idx]) return;
    _templateSlots[idx].key = key;
    _templateSlots[idx].format = format || null;
    closeChipDropdowns();
    renderTemplateChips();
    updateParseTableBody(); // update the preview without re-rendering headers
    testRename();
  }

  function addChipSlot() {
    // Show a minimal dropdown at the "+" button with column options
    var btn = document.querySelector('.template-chip-add');
    if (!btn) return;
    closeChipDropdowns();

    var dd = document.createElement('div');
    dd.className = 'chip-dd open';
    dd.style.left = '0';
    dd.style.right = 'auto';

    NORM_COLUMNS.forEach(function(c) {
      var item = document.createElement('button');
      item.className = 'chip-dd-item';
      item.innerHTML = '<span class="dd-label">' + c.label + '</span><span class="dd-hint">' + c.key + '</span>';
      item.onclick = function(e2) {
        e2.stopPropagation();
        if (_templateSlots.length > 0) _templateSlots.push({ key: 'sep', text: '_' });
        _templateSlots.push({ key: c.key, label: c.label });
        closeChipDropdowns();
        renderTemplateChips();
        updateParseTableBody();
        testRename();
      };
      dd.appendChild(item);
    });

    btn.parentNode.appendChild(dd);
  }

  function removeChipSlot(idx) {
    if (idx < 0 || idx >= _templateSlots.length) return;
    // Remove adjacent separator too
    if (idx > 0 && _templateSlots[idx-1].key === 'sep') {
      _templateSlots.splice(idx-1, 2);
    } else if (idx + 1 < _templateSlots.length && _templateSlots[idx+1].key === 'sep') {
      _templateSlots.splice(idx, 2);
    } else {
      _templateSlots.splice(idx, 1);
    }
    closeChipDropdowns();
    renderTemplateChips();
    updateParseTableBody();
    testRename();
  }

  function updateParseTableBody() {
      var tbody = document.getElementById('parse-tbody');
      if (!tbody) return;
      var html = '';
      for (var i = 0; i < rawChannels.length; i++) {
        var ch = rawChannels[i];
        var caps = ch.caps || (ch.caps = parseName(ch.raw));
        var normalized = applyTemplate(caps, document.getElementById('output-template').value);
        html += '<tr>'
          + '<td class="ch-num">' + esc(ch.num) + '</td>'
          + '<td class="raw-name">' + esc(ch.raw) + ' <span class="bext-tag">' + esc(ch.bext) + '</span></td>';
        NORM_COLUMNS.forEach(function(c) {
          var val;
          if (c.key === 'type') {
            val = (caps.type !== undefined && caps.type !== '') ? caps.type : typeLabel(caps.prefix);
          } else {
            val = caps[c.key] || '';
          }
          // No inline handlers here: interaction is delegated from #parse-tbody
          // (CSP script-src 'self' blocks attribute handlers).
          html += '<td class="capture-group" contenteditable="true" spellcheck="false" data-key="' + c.key + '"'
            + ' data-ch="' + i + '">' + esc(val) + '</td>';
        });
        html += '<td class="normalized">' + esc(normalized) + '</td>'
          + '</tr>';
      }
      tbody.innerHTML = html;
      // Re-apply selection highlight after re-render (drop if out of bounds)
      reapplyNormSel();
    }

  // HTML for column header row (draggable)
  function renderNormHeaders() {
    var html = '<tr>';
    html += '<th style="width:44px;">#</th>';
    html += '<th>Raw channel</th>';
    NORM_COLUMNS.forEach(function(c, idx) {
      html += '<th style="min-width:' + c.width + ';cursor:grab;" draggable="true"'
        + ' data-col-idx="' + idx + '" data-col-key="' + c.key + '"'
        + ' title="' + esc(c.template ? 'In template (click the dot to remove)' : 'Not in template (click the dot to add)') + '"'
        + ' aria-label="' + esc(c.label) + ' column">'
        + '<span class="col-toggle" data-col-toggle="' + idx + '" role="button" tabindex="0"'
        + ' aria-pressed="' + (c.template ? 'true' : 'false') + '"'
        + ' title="' + (c.template ? 'In template (click to remove)' : 'Not in template (click to add)') + '"'
        + ' style="cursor:pointer;margin-right:4px;font-size:10px;">' + (c.template ? '&#x25CF;' : '&#x25CB;') + '</span>'
        + esc(c.label) + '</th>';
    });
    html += '<th>Normalized name</th>';
    html += '</tr>';
    return html;
  }

  // CSP migration: parse-table interactions are delegated at table scope.
  // (Generated drag/dblclick/blur attributes were dead under script-src
  // 'self'.) Keyboard: col-toggle dots respond to Enter/Space.
  (function wireParseTable() {
    var tbody = document.getElementById('parse-tbody');
    var table = document.getElementById('parse-table');
    if (!tbody || !table) return;
    var thead = document.querySelector('#parse-table thead');

    // Cell selection (mousedown) + edit commit (focusout)
    tbody.addEventListener('mousedown', function(e) {
      var td = e.target.closest('td');
      if (!td || !td.classList.contains('capture-group')) return;
      onNormCellMouseDown(e);
    });
    tbody.addEventListener('focusout', function(e) {
      var td = e.target.closest ? e.target.closest('td.capture-group') : null;
      if (td) commitNormCell(td);
    });

    if (!thead) return;
    // Column drag-reorder + double-click label edit + toggle dot clicks
    thead.addEventListener('dragstart', onColDragStart);
    thead.addEventListener('dragover', onColDragOver);
    thead.addEventListener('drop', onColDrop);
    thead.addEventListener('dragend', onColDragEnd);
    thead.addEventListener('dblclick', function(e) {
      var th = e.target.closest('th');
      if (th && th.hasAttribute('data-col-key')) onColLabelEdit(th);
    });
    function onToggleActivate(span) {
      var idx = parseInt(span.getAttribute('data-col-toggle'), 10);
      if (!isNaN(idx)) toggleColTemplate(idx);
    }
    thead.addEventListener('click', function(e) {
      var span = e.target.closest('.col-toggle');
      if (span) { e.stopPropagation(); onToggleActivate(span); }
    });
    thead.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var span = e.target.closest('.col-toggle');
      if (span) { e.preventDefault(); e.stopPropagation(); onToggleActivate(span); }
    });
  })();

  function updateParseTable() {
    var thead = document.querySelector('#parse-table thead');
    var tbody = document.getElementById('parse-tbody');
    if (thead) thead.innerHTML = renderNormHeaders();

    // Re-sync template slots from column order (unless manually edited)
    syncTemplateSlots();
    renderTemplateChips();

    updateParseTableBody();
    testRename();
  }

  // Inline edit: update capture group on blur, re-normalize for that row
    function onNormCellBlur(el) {
      commitNormCell(el);
    }

    // Commit an edited/pasted capture cell into the data model and re-normalize
    function commitNormCell(td) {
      var key = td.getAttribute('data-key');
      var chIdx = parseInt(td.getAttribute('data-ch'), 10);
      if (isNaN(chIdx) || chIdx < 0 || chIdx >= rawChannels.length) return;
      var ch = rawChannels[chIdx];
      if (!ch.caps) ch.caps = parseName(ch.raw);
      ch.caps[key] = td.textContent.trim();
      var template = document.getElementById('output-template').value;
      var normalized = applyTemplate(ch.caps, template);
      var row = td.parentElement;
      var normCell = row.querySelector('.normalized');
      if (normCell) normCell.textContent = normalized;
      testRename();
    }

    // ===== Normalize table: cell selection + copy/paste =====
    var _normSel = null; // { r1, c1, r2, c2 } inclusive; null = no selection
    var _lastNormClick = { t: 0, r: -1, c: -1 };

    function normCellPos(td) {
      var tr = td.closest('tr');
      if (!tr) return null;
      var tbody = tr.parentElement;
      if (!tbody) return null;
      var row = Array.prototype.indexOf.call(tbody.children, tr);
      var col = Array.prototype.indexOf.call(tr.children, td);
      if (row < 0 || col < 0) return null;
      return { r: row, c: col };
    }

    function normSelRect() {
      if (!_normSel) return null;
      return {
        r1: Math.min(_normSel.r1, _normSel.r2),
        c1: Math.min(_normSel.c1, _normSel.c2),
        r2: Math.max(_normSel.r1, _normSel.r2),
        c2: Math.max(_normSel.c1, _normSel.c2),
      };
    }

    function isEditingNormCell() {
      var a = document.activeElement;
      return !!(a && a.classList && a.classList.contains('capture-group') && a.isContentEditable);
    }

    function onNormCellMouseDown(e) {
      var td = e.target.closest('td');
      if (!td || !td.closest('#parse-table')) return;
      var pos = normCellPos(td);
      if (!pos) return;

      var now = Date.now();
      var isDbl = (now - _lastNormClick.t < 350) && (_lastNormClick.r === pos.r) && (_lastNormClick.c === pos.c);
      _lastNormClick = { t: now, r: pos.r, c: pos.c };
      if (isDbl) return; // allow the contenteditable to enter edit mode

      // Commit any in-progress edit before changing selection
      var active = document.activeElement;
      if (active && active !== td && active.isContentEditable) active.blur();

      e.preventDefault(); // keep focus out so we control selection
      if (e.shiftKey && _normSel) {
        _normSel.r2 = pos.r;
        _normSel.c2 = pos.c;
      } else {
        _normSel = { r1: pos.r, c1: pos.c, r2: pos.r, c2: pos.c };
      }
      applyNormSel();
    }

    function applyNormSel() {
      var tbody = document.getElementById('parse-tbody');
      if (!tbody) return;
      var rect = normSelRect();
      var cells = tbody.querySelectorAll('td');
      for (var i = 0; i < cells.length; i++) {
        var pos = normCellPos(cells[i]);
        var on = rect && pos && pos.r >= rect.r1 && pos.r <= rect.r2 && pos.c >= rect.c1 && pos.c <= rect.c2;
        if (on) cells[i].classList.add('cell-selected');
        else cells[i].classList.remove('cell-selected');
      }
    }

    function clearNormSel() {
      _normSel = null;
      var cells = document.querySelectorAll('#parse-table td.cell-selected');
      for (var i = 0; i < cells.length; i++) cells[i].classList.remove('cell-selected');
    }

    function reapplyNormSel() {
      if (!_normSel) return;
      var tbody = document.getElementById('parse-tbody');
      if (!tbody || !tbody.children.length) { _normSel = null; return; }
      var rows = tbody.children.length;
      var cols = tbody.children[0].children.length;
      var rect = normSelRect();
      if (!rect || rect.r2 >= rows || rect.c2 >= cols) { _normSel = null; return; }
      applyNormSel();
    }

    function copyNormSelection() {
      var rect = normSelRect();
      if (!rect) return '';
      var tbody = document.getElementById('parse-tbody');
      if (!tbody) return '';
      var lines = [];
      for (var r = rect.r1; r <= rect.r2; r++) {
        var rowEl = tbody.children[r];
        if (!rowEl) break;
        var line = [];
        for (var c = rect.c1; c <= rect.c2; c++) {
          var td = rowEl.children[c];
          if (!td) break;
          line.push(td.textContent.trim());
        }
        lines.push(line.join('\t'));
      }
      return lines.join('\n');
    }

    function pasteNormSelection(text) {
      var sel = _normSel;
      if (!sel || !text) return 0;
      var lines = String(text).replace(/\r?\n/g, '\n').split('\n');
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      if (!lines.length) return 0;
      var grid = lines.map(function(l) { return l.split('\t'); });
      var gridRows = grid.length;
      var gridCols = grid.reduce(function(m, row) { return Math.max(m, row.length); }, 0);
      if (!gridCols) return 0;

      var rect = normSelRect();
      var tRows, tCols;
      if (rect.r1 === rect.r2 && rect.c1 === rect.c2) {
        tRows = gridRows; tCols = gridCols; // paste the full grid from the anchor cell
      } else {
        tRows = rect.r2 - rect.r1 + 1;
        tCols = rect.c2 - rect.c1 + 1;
      }

      var tbody = document.getElementById('parse-tbody');
      if (!tbody) return 0;
      var count = 0;
      for (var ri = 0; ri < tRows; ri++) {
        var r = rect.r1 + ri;
        var rowEl = tbody.children[r];
        if (!rowEl) break;
        var rowVals = grid[ri % gridRows];
        for (var ci = 0; ci < tCols; ci++) {
          var c = rect.c1 + ci;
          var td = rowEl.children[c];
          if (!td) break;
          if (!td.classList.contains('capture-group')) continue;
          td.textContent = rowVals[ci % rowVals.length] !== undefined ? rowVals[ci % rowVals.length] : '';
          commitNormCell(td);
          count++;
        }
      }
      return count;
    }

    // Copy/paste at the document level (Ctrl+C / Ctrl+V, right-click, Shift+Insert)
    document.addEventListener('copy', function(e) {
      if (isEditingNormCell() || !_normSel) return; // native behavior
      var text = copyNormSelection();
      if (!text) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      var cells = (_normSel.r1 === _normSel.r2 && _normSel.c1 === _normSel.c2) ? 1
        : (Math.abs(_normSel.r2 - _normSel.r1) + 1) * (Math.abs(_normSel.c2 - _normSel.c1) + 1);
      showToast('Copied ' + cells + ' cell' + (cells === 1 ? '' : 's'));
    });

    document.addEventListener('paste', function(e) {
      if (isEditingNormCell() || !_normSel) return; // native behavior
      var text = e.clipboardData.getData('text/plain');
      if (!text) return;
      var count = pasteNormSelection(text);
      if (count > 0) {
        e.preventDefault();
        showToast('Pasted into ' + count + ' cell' + (count === 1 ? '' : 's'));
      }
    });

    // Click outside the table clears the selection; Escape clears too
    document.addEventListener('mousedown', function(e) {
      if (!_normSel) return;
      if (e.target.closest && e.target.closest('#parse-table')) return;
      clearNormSel();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !isEditingNormCell()) clearNormSel();
    });

  // Column drag-and-drop
  var _colDragSrc = null;

  function onColDragStart(e) {
    var th = e.target.closest('th');
    if (!th) return;
    _colDragSrc = parseInt(th.getAttribute('data-col-idx'), 10);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(_colDragSrc));
    if (th) th.style.opacity = '0.5';
  }

  function onColDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var th = e.target.closest('th');
    if (th) th.style.borderBottom = '2px solid var(--tomato)';
  }

  function onColDrop(e) {
    e.preventDefault();
    var th = e.target.closest('th');
    if (!th) return;
    var targetIdx = parseInt(th.getAttribute('data-col-idx'), 10);
    if (isNaN(targetIdx) || _colDragSrc === null || _colDragSrc === targetIdx) return;
        clearNormSel();
        // Reorder NORM_COLUMNS
    var item = NORM_COLUMNS.splice(_colDragSrc, 1)[0];
    NORM_COLUMNS.splice(targetIdx, 0, item);
    // Clear manual flag on template to allow auto-generation
    var templateEl = document.getElementById('output-template');
    if (templateEl) templateEl.removeAttribute('data-manual');
    // Re-render
    updateParseTable();
    // Visual feedback
    var headers = document.querySelectorAll('#parse-table thead th[draggable]');
    headers.forEach(function(h) { h.style.borderBottom = ''; });
    showToast('Columns reordered');
  }

  function onColDragEnd(e) {
    e.target.style.opacity = '';
    var headers = document.querySelectorAll('#parse-table thead th[draggable]');
    headers.forEach(function(h) { h.style.borderBottom = ''; });
    _colDragSrc = null;
  }

  function testRename() {
    var raw = document.getElementById('test-raw').value;
    var caps = parseName(raw);
    var normalized = applyTemplate(caps, document.getElementById('output-template').value);
    document.getElementById('test-result').textContent = normalized;
  }

  // Toggle whether a column contributes to the template
  function toggleColTemplate(idx) {
    if (idx < 0 || idx >= NORM_COLUMNS.length) return;
    NORM_COLUMNS[idx].template = !NORM_COLUMNS[idx].template;
    updateParseTable();
  }

  // Parse a template string into _templateSlots array
  function parseTemplateString(tmpl) {
    var slots = [];
    var re = /\{(\w+)(?::(\d+)d)?\}/g;
    var lastIdx = 0, m;
    while ((m = re.exec(tmpl)) !== null) {
      if (m.index > lastIdx) slots.push({ key: 'sep', text: tmpl.substring(lastIdx, m.index) });
      var slot = { key: m[1] };
      if (m[2]) slot.format = m[2];
      slots.push(slot);
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < tmpl.length) slots.push({ key: 'sep', text: tmpl.substring(lastIdx) });
    return slots;
  }

  function loadPreset(val) {
    var pattern, template;
    if (val === 'mkr') {
      pattern = '^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)_?(?<num>\\d+)?$';
      template = '{prefix}_{role}_{num}';
    } else if (val === 'blk') {
      pattern = '^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)(?:_?(?<num>\\d+))?$';
      template = 'BLK_{prefix}_{role}_{num}';
    } else if (val === 'svr') {
      pattern = '^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)_?(?<num>\\d+)?$';
      template = 'SVR_{prefix}_{role}_{num}';
    } else {
      pattern = document.getElementById('regex-pattern').value;
      template = document.getElementById('output-template').value;
    }
    document.getElementById('regex-pattern').value = pattern;
    document.getElementById('output-template').value = template;
    _templateSlots = parseTemplateString(template);
    renderTemplateChips();
    updateParseTableBody();
    testRename();
    showToast('Preset loaded: ' + val.toUpperCase());
  }

  // ===== Editable column headers =====
  function onColLabelEdit(th) {
    th.dataset.original = th.textContent;
    th.contentEditable = 'true';
    th.focus();
    var range = document.createRange();
    range.selectNodeContents(th);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Close template chip dropdowns when clicking elsewhere
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.template-chip') && !e.target.closest('.template-chip-add')) {
      closeChipDropdowns();
    }
  });

  // Save column header label on blur, re-render
  document.addEventListener('focusout', function(e) {
    if (e.target.hasAttribute('data-col-key') && e.target.contentEditable === 'true') {
      var th = e.target;
      var idx = parseInt(th.getAttribute('data-col-idx'), 10);
      var newLabel = (th.textContent.trim() || th.dataset.original);
      if (idx >= 0 && idx < NORM_COLUMNS.length) {
        NORM_COLUMNS[idx].label = newLabel;
      }
      th.contentEditable = 'false';
      delete th.dataset.original;
      updateParseTable();
    }
  });

  // ===== Inline edit handlers =====
  document.addEventListener('keydown', function(e) {
    if (e.target.classList.contains('editable-text')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        var orig = e.target.getAttribute('data-original');
        if (orig !== null) e.target.textContent = orig;
        e.target.blur();
      }
    }
    if (e.target.hasAttribute('data-col-key') && e.target.contentEditable === 'true') {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        var orig = e.target.getAttribute('data-original');
        if (orig !== null) e.target.textContent = orig;
        e.target.blur();
      }
    }
  });

  document.addEventListener('focusin', function(e) {
    if (e.target.classList.contains('editable-text')) {
      e.target.setAttribute('data-original', e.target.textContent);
      e.target.classList.add('editing');
    }
  });

  document.addEventListener('focusout', function(e) {
    if (e.target.classList.contains('editable-text')) {
      e.target.classList.remove('editing');
      var old = e.target.getAttribute('data-original');
      var val = e.target.textContent.trim();
      if (val && val !== old) {
        showToast('Renamed: ' + (old || 'unnamed') + ' \u2192 ' + val);
      }
    }
  });

  // ===== Route tab functions =====
  function updatePreview(select, channelName) {
    var span = select.closest('tr').querySelector('.track-preview span');
    if (select.value) {
      var label = select.options[select.selectedIndex].text.split(' \u2014 ')[0];
      var name = label + '_' + channelName;
      span.className = 'track-name editable-text';
      span.setAttribute('contenteditable', 'true');
      span.textContent = name;
      select.classList.add('assigned');
    } else {
      span.className = 'unassigned';
      span.textContent = '\u2014';
      span.removeAttribute('contenteditable');
      select.classList.remove('assigned');
    }
    updateSummary();
  }

  function updateSummary() {
    var selects = document.querySelectorAll('.track-select.assigned');
    var count = document.querySelector('.bottom-bar .info strong');
    count.textContent = selects.length;
  }

  // ===== Settings panel =====
  function toggleSettings() {
    var overlay = document.getElementById('settingsOverlay');
    var btn = document.getElementById('settingsToggle');
    overlay.classList.toggle('open');
    btn.classList.toggle('open');
    document.body.style.overflow = overlay.classList.contains('open') ? 'hidden' : '';
    syncThemeOptions();
  }
  function toggleTheme() {
    var root = document.documentElement;
    var isLight = root.classList.toggle('light-mode');
    document.body.classList.toggle('light-mode', isLight);
    try { localStorage.setItem('polywav-theme', isLight ? 'light' : 'dark'); } catch(e) {}
    if (window.syncThemeColors) window.syncThemeColors(isLight);
    syncThemeOptions();
  }
  function setThemeFromSettings(mode) {
    var isLight = (mode === 'light');
    document.documentElement.classList.toggle('light-mode', isLight);
    document.body.classList.toggle('light-mode', isLight);
    try { localStorage.setItem('polywav-theme', isLight ? 'light' : 'dark'); } catch(e) {}
    if (window.syncThemeColors) window.syncThemeColors(isLight);
    syncThemeOptions();
  }
  function syncThemeOptions() {
    var isLight = document.documentElement.classList.contains('light-mode');
    var darkOpt = document.getElementById('themeDarkOpt');
    var lightOpt = document.getElementById('themeLightOpt');
    if (darkOpt) darkOpt.classList.toggle('active', !isLight);
    if (lightOpt) lightOpt.classList.toggle('active', isLight);
  }
  // Restore saved theme on load
  (function() {
    var saved = null;
    try { saved = localStorage.getItem('polywav-theme'); } catch(e) {}
    if (saved === 'light') {
      document.documentElement.classList.add('light-mode');
      document.body.classList.add('light-mode');
      if (window.syncThemeColors) window.syncThemeColors(true);
    }
    syncThemeOptions();
  })();
  function closeSettingsOutside(e) {
    if (e.target === e.currentTarget) toggleSettings();
  }
  function setMode(el, mode) {
    el.parentElement.querySelectorAll('.seg-option').forEach(function(o) { o.classList.remove('active'); });
    el.classList.add('active');
    showToast('Mode: ' + mode);
  }
  function setEssence(el, type) {
    el.parentElement.querySelectorAll('.seg-option').forEach(function(o) { o.classList.remove('active'); });
    el.classList.add('active');
    showToast('Media: ' + type);
  }
  // Close settings on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var overlay = document.getElementById('settingsOverlay');
      if (overlay && overlay.classList.contains('open')) toggleSettings();
    }
  });

  var toastTimeout;
  function showToast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function() { el.classList.remove('show'); }, 2200);
  }

  // ===== App-wide canvas waveform animation + particles =====
  (function() {
    var canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W, H, _inkRGB = '242,236,227', _inkParticle = 'rgba(242,236,227,';
    var _waves = [
      { amp: 28, freq: 0.015, speed: 0.005, phase: 0, color: 'rgba(242,236,227,0.15)' },
      { amp: 18, freq: 0.028, speed: 0.009, phase: 1.8, color: 'rgba(196,102,74,0.12)' },
      { amp: 12, freq: 0.042, speed: 0.013, phase: 3.2, color: 'rgba(200,169,110,0.09)' },
      { amp: 7,  freq: 0.058, speed: 0.017, phase: 0.7, color: 'rgba(122,158,140,0.07)' },
    ];

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Expose theme sync so toggleTheme() can update canvas colors
    window.syncThemeColors = function(isLight) {
      _inkRGB = isLight ? '42,39,35' : '242,236,227';
      _inkParticle = 'rgba(' + _inkRGB + ',';
      _waves[0].color = 'rgba(' + _inkRGB + ',0.15)';
    };

    var particles = [];
    var MAX_PARTICLES = 35;
    for (var i = 0; i < MAX_PARTICLES; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4 - 0.08,
        r: 1 + Math.random() * 2.5,
        o: 0.15 + Math.random() * 0.35,
        life: Math.random() * 300,
        maxLife: 300 + Math.random() * 200,
      });
    }

    var time = 0;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      time += 1;

      // Waves
      _waves.forEach(function(w) {
        ctx.beginPath();
        var yBase = H * 0.5;
        for (var x = 0; x < W; x += 2) {
          var y = yBase + Math.sin(x * w.freq + time * w.speed + w.phase) * w.amp
                    + Math.sin(x * w.freq * 2.3 + time * w.speed * 0.6 + w.phase * 1.5) * w.amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Particles
      particles.forEach(function(p) {
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        if (p.life > p.maxLife || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
          p.x = Math.random() * W;
          p.y = H + 10;
          p.vx = (Math.random() - 0.5) * 0.4;
          p.vy = -0.1 - Math.random() * 0.3;
          p.life = 0;
        }
        var fade = 1 - (p.life / p.maxLife);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = _inkParticle + (p.o * fade * 0.4) + ')';
        ctx.fill();
      });

      requestAnimationFrame(draw);
    }
    draw();
  })();

  // ===== App-wide parallax mouse effect =====
  (function() {
    var para = document.getElementById('dropZoneParallax');
    var orbs = [document.getElementById('orb1'), document.getElementById('orb2'), document.getElementById('orb3')];
    if (!para && orbs.every(function(o) { return !o; })) return;

    document.addEventListener('mousemove', function(e) {
      var dx = (e.clientX / window.innerWidth - 0.5) * 2;
      var dy = (e.clientY / window.innerHeight - 0.5) * 2;
      if (para) para.style.transform = 'translate(' + (dx * -10) + 'px, ' + (dy * -8) + 'px)';
      orbs.forEach(function(orb, i) {
        if (!orb) return;
        orb.style.transform = 'translate(' + (dx * (12 + i * 8)) + 'px, ' + (dy * (10 + i * 6)) + 'px)';
      });
    });
  })();

  // ===== Fixed header: compensate for height so content doesn't hide behind it =====
  (function() {
    var header = document.getElementById('stickyHeader');
    var wrap = document.querySelector('.app-wrap');
    if (!header || !wrap) return;
    function pad() { wrap.style.paddingTop = header.offsetHeight + 'px'; }
    pad();
    window.addEventListener('resize', pad);
  })();

  // ===== Home tab: Drop zone interactions =====
  (function() {
    var zone = document.getElementById('dropZone');
    var input = document.getElementById('fileInput');
    var btn = document.getElementById('dropZoneBtn');
    if (!zone) return;

        // Update hero header with file metadata
        function updateHeroMeta(info) {
          var elSub = document.getElementById('heroSubtitle');
          var elMeta = document.getElementById('heroMeta');
          var elDot = document.getElementById('heroStatusDot');
          if (elSub) {
            elSub.innerHTML = '<strong>' + esc(_clipName || 'Polywav Ingest') + '</strong> &middot; '
              + (info ? info.channels + ' channels' : 'Ready to load');
          }
          if (elMeta && info) {
                      var sr = info.sampleRate >= 1000 ? (info.sampleRate / 1000).toFixed(0) + ' kHz' : info.sampleRate + ' Hz';
                      elMeta.innerHTML = info.channels + ' channels \u00B7 ' + sr + ' \u00B7 ' + info.bitDepth + '-bit';
                    }
          if (elDot) {
            elDot.style.color = info ? 'var(--sage)' : 'var(--tomato)';
          }
        }

        // Build routing data and raw channels from probe metadata
                function buildDataFromProbe(info) {
                  var names = info.channelNames && info.channelNames.length === info.channels
                    ? info.channelNames
                    : [];
                  // Generate names if probe didn't produce them
                  for (var i = names.length; i < info.channels; i++) {
                    names.push('Channel ' + String(i + 1).padStart(2, '0'));
                  }
                  // Build ROUTING_DATA
                  var route = [];
                  var raw = [];
                  for (var i = 0; i < info.channels; i++) {
                    var chNum = String(i + 1).padStart(2, '0');
                    var chName = names[i];
                                        // Auto-detect separator for bext description display
                                        var bextSep = '_';
                                        if (chName.indexOf(' ') >= 0) bextSep = ' ';
                                        else if (chName.indexOf('-') >= 0) bextSep = '-';
                                        else if (chName.indexOf('.') >= 0) bextSep = '.';
                                        var parts = chName.split(bextSep);
                                        var bextDesc = parts.length > 1 ? parts.slice(1).join(' ').trim() : chName.toLowerCase();
                    route.push({ ch: chNum, name: chName, group: null, track: null, color: '#ccc' });
                    raw.push({ num: chNum, raw: chName, bext: bextDesc });
                  }
                  ROUTING_DATA.length = 0;
                  rawChannels.length = 0;
                  Array.prototype.push.apply(ROUTING_DATA, route);
                  Array.prototype.push.apply(rawChannels, raw);
                }

                // ===== Pure-JS WAV header parser (works in browser & Electron) =====
                function parseWavHeaderBytes(buf) {
                  // buf is a Uint8Array of at least 44 bytes
                  if (buf.length < 44) return null;
                  // Check RIFF / WAVE magic
                  if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46) return null;
                  if (buf[8] !== 0x57 || buf[9] !== 0x41 || buf[10] !== 0x56 || buf[11] !== 0x45) return null;

                  var view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                  var pos = 12;
                  var fmt = null;
                  var dataSize = 0;

                  while (pos + 8 <= buf.length) {
                    var ckID = String.fromCharCode(buf[pos], buf[pos+1], buf[pos+2], buf[pos+3]);
                    var ckSize = view.getUint32(pos + 4, true);
                    if (ckID === 'fmt ') {
                      fmt = {
                        channels: view.getUint16(pos + 10, true),
                        sampleRate: view.getUint32(pos + 12, true),
                        bitsPerSample: view.getUint16(pos + 22, true),
                      };
                    } else if (ckID === 'data') {
                      dataSize = ckSize;
                    }
                    pos += 8 + ckSize + (ckSize % 2);
                    if (pos >= buf.length) break;
                  }
                  if (!fmt) return null;

                  var frames = (dataSize > 0 && fmt.channels > 0 && fmt.bitsPerSample > 0)
                    ? Math.floor(dataSize / (fmt.channels * fmt.bitsPerSample / 8))
                    : 0;

                  return {
                    channels: fmt.channels,
                    sampleRate: fmt.sampleRate,
                    bitsPerSample: fmt.bitsPerSample,
                    frames: frames,
                    format: 'WAV / PCM_' + fmt.bitsPerSample,
                  };
                }

                function readWavHeaderFromFile(file) {
                  return new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function(e) {
                      var header = parseWavHeaderBytes(new Uint8Array(e.target.result));
                      if (header) resolve(header);
                      else reject(new Error('Invalid WAV header'));
                    };
                    reader.onerror = function() { reject(new Error('Failed to read file')); };
                    reader.readAsArrayBuffer(file.slice(0, 4096));
                  });
                }

                // Shared finalizer: merges WAV header + optional BEXT probe, builds routing
                var _loadEpoch = 0;  // bumped per load; stale async callbacks bail out
                function finalizeFileLoad(meta, bextProbePromise) {
                  var epoch = ++_loadEpoch;
                  function finish(names) {
                    if (epoch !== _loadEpoch) return;  // a newer load superseded this one
                    meta.channelNames = names;
                    _fileInfo = meta;
                    buildDataFromProbe(meta);
                    updateHeroMeta(meta);
                    updateEmptyStates();
                    rerenderAll();
                    renderExportTab();
                    showFileLoaded();
                  }

                  function defaultNames(n) {
                    var a = [];
                    for (var i = 0; i < n; i++) a.push('Channel ' + String(i + 1).padStart(2, '0'));
                    return a;
                  }

                  if (bextProbePromise) {
                    bextProbePromise.then(function(info) {
                      if (info && !info.error && info.channelNames && info.channelNames.length === meta.channels) {
                        finish(info.channelNames);
                      } else {
                        finish(defaultNames(meta.channels));
                      }
                    }).catch(function() {
                      finish(defaultNames(meta.channels));
                    });
                  } else {
                    finish(defaultNames(meta.channels));
                  }
                }

                // Handle file from drag-and-drop or file input
                function handleFile(file) {
                  if (!file) return;
                  _fileLoaded = true;
                  _filePath = file.path || file.name;
                  _clipName = file.name.replace(/\.wav$/i, '').replace(/\.polywav$/i, '') || 'export';

                  // Step 1: Always read WAV header first — gives real channel count in any context
                  readWavHeaderFromFile(file).then(function(wavInfo) {
                    var meta = {
                      file: _filePath,
                      channels: wavInfo.channels,
                      sampleRate: wavInfo.sampleRate,
                      frames: wavInfo.frames,
                      format: wavInfo.format,
                      bitDepth: wavInfo.bitsPerSample,
                      channelNames: [],
                    };
                    // Step 2: Try Electron IPC for BEXT channel names if available
                    var probePromise = null;
                    if (file.path && window.electronAPI && window.electronAPI.probeFile) {
                      probePromise = window.electronAPI.probeFile(file.path);
                    }
                    finalizeFileLoad(meta, probePromise);
                  }).catch(function() {
                    // Can't read WAV header — last resort fallback
                    var meta = { file: _filePath, channels: 1, sampleRate: 48000, frames: 0, format: 'WAV / PCM_24', bitDepth: 24 };
                    finalizeFileLoad(meta, null);
                  });

                  // Add to recent files (non-blocking, always)
                  var name = file.name;
                  var size = (file.size / 1024 / 1024).toFixed(1) + ' MB';
                  var now = new Date();
                  var time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  addRecentFileItem(name, size, time);
                  showToast('Loaded: ' + name);
                }

                // Handle file from Electron open dialog (path string, not File object)
                function handleFilePath(filePath) {
                  if (!filePath) return;
                  _fileLoaded = true;
                  _filePath = filePath;
                  var parts = filePath.replace(/\\/g, '/').split('/');
                  var fileName = parts[parts.length - 1];
                  _clipName = fileName.replace(/\.wav$/i, '').replace(/\.polywav$/i, '') || 'export';

                  // Step 1: Read WAV header via IPC (main process reads file bytes)
                  if (window.electronAPI && window.electronAPI.readFileHeader) {
                    window.electronAPI.readFileHeader(filePath).then(function(wavInfo) {
                      if (wavInfo && !wavInfo.error) {
                        var meta = {
                          file: filePath,
                          channels: wavInfo.channels,
                          sampleRate: wavInfo.sampleRate,
                          frames: wavInfo.frames,
                          format: wavInfo.format,
                          bitDepth: wavInfo.bitsPerSample,
                          channelNames: [],
                        };
                        // Step 2: Try BEXT probe
                        var probePromise = (window.electronAPI && window.electronAPI.probeFile)
                          ? window.electronAPI.probeFile(filePath) : null;
                        finalizeFileLoad(meta, probePromise);
                      } else {
                        var meta = { file: filePath, channels: 1, sampleRate: 48000, frames: 0, format: 'WAV / PCM_24', bitDepth: 24 };
                        finalizeFileLoad(meta, null);
                      }
                    }).catch(function() {
                      var meta = { file: filePath, channels: 1, sampleRate: 48000, frames: 0, format: 'WAV / PCM_24', bitDepth: 24 };
                      finalizeFileLoad(meta, null);
                    });
                  } else {
                    // No IPC available (shouldn't happen in Electron, but fallback)
                    var meta = { file: filePath, channels: 1, sampleRate: 48000, frames: 0, format: 'WAV / PCM_24', bitDepth: 24 };
                    finalizeFileLoad(meta, null);
                  }

                  // Add to recent files (path stored locally so the entry is
                  // click-to-reload; same machine, same trust domain)
                  var name = fileName;
                  var size = '?.? MB';
                  var now = new Date();
                  var time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  addRecentFileItem(name, size, time, filePath);
                  showToast('Loaded: ' + name);
                }

                // CSP-sprint follow-up (journey audit #1): recents wiring lives
                // outside this IIFE; expose the loader entry points so activate()
                // can call them without crossing closures.
                window.handleFilePath = handleFilePath;
                window.finalizeFileLoad = finalizeFileLoad;

              if (btn) btn.addEventListener('click', function(e) {
                              e.stopPropagation();
                              if (window.electronAPI && window.electronAPI.openFile) {
                                window.electronAPI.openFile().then(handleFilePath);
                              } else {
                                if (input) input.click();
                              }
                            });
                  // Drop zone click: delegate to btn click when not on button, or use IPC in Electron
                  if (window.electronAPI && window.electronAPI.openFile) {
                    zone.addEventListener('click', function(e) {
                      if (e.target.closest('.drop-zone-btn')) return;
                      window.electronAPI.openFile().then(handleFilePath);
                    });
                  } else {
                    zone.addEventListener('click', function() { if (input) input.click(); });
                  }
    if (input) {
      input.addEventListener('change', function() {
        if (this.files.length > 0) handleFile(this.files[0]);
      });
    }
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function(e) { e.preventDefault(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
  })();

  // ===== Home tab: Recent files =====
      // Shared creator for recent-file entries (audit N-2/N-17): builds DOM
      // nodes with textContent so untrusted filenames are never parsed as
      // HTML. The list is driven by the _recentFiles data model; this only
      // appends and re-renders.
      var _recentFiles = [];  // [{name, size, time, path}] — single source of truth

      // CSP migration: recents activation is delegated here (the old markup
      // had no inline handlers; items are plain divs). Clicking an entry
      // reloads that file via its stored absolute path. Entries recorded
      // before paths were persisted stay visible but inert.
      (function wireRecentList() {
        var list = document.getElementById('recentList');
        if (!list) return;
        function activate(entry) {
          if (!entry) return;
          if (!entry.path) { showToast('No stored path for this entry — load it again manually'); return; }
          showToast('Reloading: ' + entry.name);
          handleFilePath(entry.path);
        }
        function entryFromItem(item) {
          var name = item && item.getAttribute('data-name');
          return _recentFiles.find(function(en) { return en.name === name; });
        }
        list.addEventListener('click', function(e) {
          var item = e.target.closest('.recent-item');
          if (item) activate(entryFromItem(item));
        });
        list.addEventListener('keydown', function(e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          var item = e.target.closest('.recent-item');
          if (item) { e.preventDefault(); activate(entryFromItem(item)); }
        });
      })();

      function renderRecentList() {
        var list = document.getElementById('recentList');
        if (!list) return;
        list.innerHTML = '';
        if (!_recentFiles.length) {
          var empty = document.createElement('div');
          empty.className = 'recent-empty';
          empty.textContent = 'No files loaded yet';
          list.appendChild(empty);
          return;
        }
        _recentFiles.forEach(function(entry) {
          var item = document.createElement('div');
          item.className = 'recent-item';
          if (entry.path) {
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.title = 'Click to reload: ' + entry.path;
          }
          item.setAttribute('aria-label', 'Recent file ' + entry.name + (entry.path ? ' (click to reload)' : ''));
          var icon = document.createElement('span');
          icon.className = 'file-icon';
          icon.innerHTML = '&#x266B;';  // static glyph, safe
          var nameEl = document.createElement('span');
          nameEl.className = 'file-name';
          nameEl.textContent = entry.name;  // untrusted -> textContent, never innerHTML
          var metaEl = document.createElement('span');
          metaEl.className = 'file-meta';
          metaEl.textContent = entry.size + ' · ' + entry.time;
          item.appendChild(icon);
          item.appendChild(nameEl);
          item.appendChild(metaEl);
          item.dataset.name = entry.name;
          item.dataset.path = entry.path || '';
          list.appendChild(item);
        });
      }

      function addRecentFileItem(name, size, time, path) {
        if (!name) return;
        // Dedupe in the data model: drop any existing entry for same name
        _recentFiles = _recentFiles.filter(function(entry) {
          return entry.name !== name;
        });
        _recentFiles.unshift({ name: name, size: size || '', time: time || '', path: path || '' });
        while (_recentFiles.length > 5) _recentFiles.pop();
        renderRecentList();
        saveRecentFiles();
      }

      function clearRecent() {
        _recentFiles = [];
        renderRecentList();
        try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
      }

      function saveRecentFiles() {
        try {
          // Persist straight from the data model (was a DOM scrape)
          localStorage.setItem(RECENT_KEY, JSON.stringify(_recentFiles));
        } catch (e) {}
      }

      function loadRecentFiles() {
        try {
          var saved = localStorage.getItem(RECENT_KEY);
          if (!saved) return;
          var data = JSON.parse(saved);
          if (!data || !data.length) return;
          _recentFiles = data.filter(function(item) {
            return item && typeof item.name === 'string';  // N-17: validate shape
          }).slice(0, 5);
          renderRecentList();
        } catch (e) {}
      }

    // ===== Home tab: Show file loaded summary / drop zone =====
    function showFileLoaded() {
      var card = document.getElementById('fileLoadedCard');
      var heroWrap = document.getElementById('heroWrap');
      if (card) {
        var nameEl = document.getElementById('flFileName');
        if (nameEl) nameEl.textContent = _clipName || _filePath || 'Unknown file';
        var detailsEl = document.getElementById('flDetails');
        if (detailsEl && _fileInfo) {
          var info = _fileInfo;
          var sr = info.sampleRate >= 1000 ? (info.sampleRate / 1000).toFixed(0) + ' kHz' : info.sampleRate + ' Hz';
          var sizeStr = '';
          if (info.frames && info.sampleRate && info.bitDepth && info.channels) {
            var bytes = info.frames * info.channels * (info.bitDepth / 8);
            sizeStr = (bytes / 1024 / 1024).toFixed(1) + ' MB';
          }
          var formatLabel = info.format ? info.format.replace('WAV / ', '') : 'Unknown';
          detailsEl.innerHTML = ''
            + '<div class="fl-detail-item"><span class="fl-detail-label">Channels</span><span class="fl-detail-value">' + info.channels + '</span></div>'
            + '<div class="fl-detail-item"><span class="fl-detail-label">Sample rate</span><span class="fl-detail-value">' + sr + '</span></div>'
            + '<div class="fl-detail-item"><span class="fl-detail-label">Bit depth</span><span class="fl-detail-value">' + info.bitDepth + '-bit</span></div>'
            + '<div class="fl-detail-item"><span class="fl-detail-label">Format</span><span class="fl-detail-value">' + formatLabel + '</span></div>'
            + (sizeStr ? '<div class="fl-detail-item"><span class="fl-detail-label">Estimated size</span><span class="fl-detail-value">' + sizeStr + '</span></div>' : '')
            + (info.frames ? '<div class="fl-detail-item"><span class="fl-detail-label">Frames</span><span class="fl-detail-value">' + info.frames.toLocaleString() + '</span></div>' : '');
        }
        card.style.display = '';
        var heroContent = heroWrap ? heroWrap.querySelector('.hero-content') : null;
        if (heroContent) {
          // Hide whichever hero children exist. .hero-badges was replaced by
          // .wizard-cta in the markup; blind querySelector here crashed every
          // file load (audit N-14).
          ['.hero-eyebrow', '.hero-title', '.hero-subtitle', '.hero-desc',
           '.hero-badges', '.wizard-cta', '.drop-zone-parallax'
          ].forEach(function(sel) {
            var el = heroContent.querySelector(sel);
            if (el) el.style.display = 'none';
          });
        }
      }
    }
    function showDropZone() {
      var card = document.getElementById('fileLoadedCard');
      var heroWrap = document.getElementById('heroWrap');
      if (card) card.style.display = 'none';
      if (heroWrap) {
        var hc = heroWrap.querySelector('.hero-content');
        if (hc) {
          var els = hc.querySelectorAll('.hero-eyebrow, .hero-title, .hero-subtitle, .hero-desc, .hero-badges, .drop-zone-parallax');
          els.forEach(function(el) { el.style.display = ''; });
        }
      }
    }

  // ===== Patch tab: Routing map renderer =====
    var GROUP_INFO = {};
      (function() {
        var colors = ['#c4664a', '#c8a96e', '#7a9e8c', '#7f8fa0', '#b088c8', '#6ab0c0', '#d4a76a', '#9cb87e'];
        for (var g = 0; g < 8; g++) {
          var start = g * 8 + 1;
          var key = 'G' + g;
          var tracks = [];
          for (var t = 0; t < 8; t++) {
            var n = start + t;
            tracks.push('A' + n);
                      }
                      GROUP_INFO[key] = {
                        label: 'A' + start + '–A' + (start + 7),
            name: 'Tracks ' + (start) + '-' + (start + 7),
            color: colors[g],
            tracks: tracks,
          };
        }
      })();

  // ===== Undo / Redo system =====
  var HISTORY_STACK = [];
  var HISTORY_INDEX = -1;
  var MAX_HISTORY = 50;

  // Call AFTER a mutation to record the resulting state
  function pushSnapshot() {
    // Discard any redo states ahead
    HISTORY_STACK = HISTORY_STACK.slice(0, HISTORY_INDEX + 1);
    var snap = JSON.parse(JSON.stringify(ROUTING_DATA));
    HISTORY_STACK.push(snap);
    if (HISTORY_STACK.length > MAX_HISTORY) HISTORY_STACK.shift();
    HISTORY_INDEX = HISTORY_STACK.length - 1;
    updateUndoButtons();
  }

  function updateUndoButtons() {
    var canUndo = HISTORY_INDEX > 0;
    var canRedo = HISTORY_INDEX < HISTORY_STACK.length - 1;
    document.querySelectorAll('#routeUndoBtn, #patchUndoBtn').forEach(function(b) { b.disabled = !canUndo; });
    document.querySelectorAll('#routeRedoBtn, #patchRedoBtn').forEach(function(b) { b.disabled = !canRedo; });
  }

  function undoAction() {
    if (HISTORY_INDEX <= 0) return;
    HISTORY_INDEX--;
    ROUTING_DATA = JSON.parse(JSON.stringify(HISTORY_STACK[HISTORY_INDEX]));
    rerenderAll();
    updateUndoButtons();
  }

  function redoAction() {
    if (HISTORY_INDEX >= HISTORY_STACK.length - 1) return;
    HISTORY_INDEX++;
    ROUTING_DATA = JSON.parse(JSON.stringify(HISTORY_STACK[HISTORY_INDEX]));
    rerenderAll();
    updateUndoButtons();
  }

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoAction(); }
    if (e.ctrlKey && e.shiftKey && e.key === 'z') { e.preventDefault(); redoAction(); }
  });

  // ===== Re-render both tabs =====
  function rerenderAll() {
      // Update channel count badges
      var routeBadge = document.getElementById('routeSourceBadge');
      var normBadge = document.getElementById('normChannelBadge');
      if (routeBadge) routeBadge.textContent = ROUTING_DATA.length;
      if (normBadge) normBadge.textContent = ROUTING_DATA.length + ' channels';

      renderRoutingMap();
            renderRouteTab();
            updateParseTable();
            updateRouteBar();
    }

  // ===== Normalised name helper =====
  function getNormNameForChannel(chIdx) {
    var ch = rawChannels[chIdx];
    if (!ch) return '';
    if (!ch.caps) ch.caps = parseName(ch.raw);
    var template = document.getElementById('output-template').value;
    return applyTemplate(ch.caps, template);
  }

  // ===== Route tab: AO track colours =====
  var AO_COLORS = ['#c4664a', '#c8a96e', '#7a9e8c', '#7f8fa0', '#b088c8', '#6ab0c0', '#d4a76a', '#9cb87e'];

  // ===== Route tab: dynamic table =====
  function renderRouteTab() {
    var tbody = document.getElementById('routeTableBody');
    var summary = document.getElementById('routeSummaryList');
    if (!tbody) return;

    var aoOpts = [];
        for (var aoi = 1; aoi <= 64; aoi++) {
          aoOpts.push('A' + aoi);
        }

    var html = '';
    ROUTING_DATA.forEach(function(d, idx) {
      var chNum = parseInt(d.ch, 10);
      var normName = getNormNameForChannel(chNum - 1);
      var assigned = d.group !== null;
      var selectHtml = '<select class="track-select' + (assigned ? ' assigned' : '') + '" data-ch="' + d.ch + '">';
      selectHtml += '<option value="">— Unassigned —</option>';

      aoOpts.forEach(function(ao) {
        var isSel = assigned && d.track === ao;
        selectHtml += '<option value="' + ao + '"' + (isSel ? ' selected' : '') + '>' + ao + '</option>';
      });

      selectHtml += '</select>';

      var trackPreview = assigned
        ? '<span class="track-name">' + d.track + '</span>'
        : '<span class="unassigned">—</span>';

      html += '<tr>'
        + '<td class="drag-handle">&#9776;</td>'
        + '<td class="ch-num">' + esc(d.ch) + '</td>'
        + '<td class="ch-name">' + esc(normName) + '</td>'
        + '<td>' + selectHtml + '</td>'
        + '<td class="track-preview">' + trackPreview + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;

    // Wire select changes
    tbody.querySelectorAll('.track-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var ch = this.getAttribute('data-ch');
        var val = this.value;
        for (var i = 0; i < ROUTING_DATA.length; i++) {
          if (ROUTING_DATA[i].ch === ch) {
            if (!val) {
              ROUTING_DATA[i].group = null;
              ROUTING_DATA[i].track = null;
              ROUTING_DATA[i].color = '#ccc';
            } else {
              var aoNum = parseInt(val.charAt(0) === 'A' ? val.slice(1) : val, 10);
              var colorIdx = Math.floor((aoNum - 1) / 8) % AO_COLORS.length;
              ROUTING_DATA[i].group = 'AO';
              ROUTING_DATA[i].track = val;
              ROUTING_DATA[i].color = AO_COLORS[colorIdx];
            }
            break;
          }
        }
        pushSnapshot();
        rerenderAll();
        showToast('Updated: Ch ' + ch + ' → ' + (val || 'unassigned'));
      });
    });

    // Render summary panel
    if (summary) {
      var sumHtml = '';
      for (var g = 0; g < 8; g++) {
        var start = g * 8 + 1;
        var end = start + 7;
        var grpLabel = 'A' + start + '–A' + end;
                sumHtml += '<li class="summary-group-header" style="color:' + AO_COLORS[g % AO_COLORS.length] + '">' + grpLabel + '</li>';
                for (var s = 0; s < 8; s++) {
                  var a = 'A' + (start + s);
                            var match = ROUTING_DATA.filter(function(d) { return d.track === a; });
                            sumHtml += '<li>'
                              + '<span class="track-label">' + a + '</span>'
            + (match.length > 0 ? '<span class="track-count">Ch ' + match.map(function(m) { return m.ch; }).join(', Ch ') + '</span>' : '<span class="track-empty">unassigned</span>')
            + '</li>';
        }
      }
      summary.innerHTML = sumHtml;

      // Update bottom-bar info
      updateRouteBar();
    }
  }

  function updateRouteBar() {
    var assigned = ROUTING_DATA.filter(function(d) { return d.group !== null; }).length;
    var total = ROUTING_DATA.length;
    var elAssigned = document.getElementById('routeInfoAssigned');
    var elTotal = document.getElementById('routeInfoTotal');
    var elMode = document.getElementById('routeInfoMode');
    var elEssence = document.getElementById('routeInfoEssence');
    if (elAssigned) elAssigned.textContent = assigned;
    if (elTotal) elTotal.textContent = total;
    if (elMode) elMode.textContent = SETTINGS.mode === 'group' ? 'Group Clip'
      : SETTINGS.mode === 'sequence' ? 'Sequence' : 'Mixed';
    if (elEssence) elEssence.textContent = SETTINGS.essence === 'embedded' ? 'Embedded in AAF'
      : SETTINGS.essence === 'external' ? 'Separate WAV files' : 'Avid MXF (OP-Atom)';
  }

  // ===== Export tab: live summary + CLI command =====
  function renderExportTab() {
    var total = ROUTING_DATA.length;
    var assigned = ROUTING_DATA.filter(function(d) { return d.group !== null; }).length;
        var trackGroups = {};
        ROUTING_DATA.forEach(function(d) {
          if (d.track) { trackGroups[d.track] = (trackGroups[d.track] || 0) + 1; }
        });
        var trackCount = Object.keys(trackGroups).length || 0;

    // Mode labels
    var modeLabel = SETTINGS.mode === 'group' ? 'Group Clip'
      : SETTINGS.mode === 'sequence' ? 'Sequence' : 'Mixed';
    var essenceLabel = SETTINGS.essence === 'embedded' ? 'Embedded in AAF'
      : SETTINGS.essence === 'external' ? 'Separate WAV files' : 'Avid MXF (OP-Atom)';

    var srLabel = SETTINGS.sampleRate === 'auto' ? 'From source' : SETTINGS.sampleRate + ' Hz';
    var bdLabel = SETTINGS.bitDepth === 'auto' ? 'From source' : SETTINGS.bitDepth + '-bit';

    var fnEl = function(id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    fnEl('exportTotalChannels', total);
    fnEl('exportAssigned', assigned);
    fnEl('exportOutputTracks', assigned > 0 ? trackCount : 0);
    fnEl('exportMode', modeLabel);
    fnEl('exportEssence', essenceLabel);
    fnEl('exportSampleRate', srLabel);
    fnEl('exportBitDepth', bdLabel);

    // Rough size estimate (16 ch × 48 kHz × 24-bit × 60 min ≈ 1.2 GB)
    var estGB = (total * (SETTINGS.bitDepth !== 'auto' ? parseInt(SETTINGS.bitDepth, 10) : 24) * 48000 * 60 * 5e-10).toFixed(1);
    fnEl('exportSize', '~' + estGB + ' GB');

    // Sync output destination fields from SETTINGS
    syncSettingsUI();
    updateAafPreview();

    // Build CLI command
        buildCLICommand();

        // Sync export format radio buttons with SETTINGS.essence
                var formatVal = SETTINGS.essence === 'external' ? 'wav' : SETTINGS.essence;  // 'embedded' or 'mxf'
                document.querySelectorAll('input[name="export-format"]').forEach(function(rb) {
          rb.checked = (rb.value === formatVal);
          var opt = rb.closest('.export-option');
          if (opt) opt.classList.toggle('selected', rb.checked);
        });
      }

  function exportFormatClick(el) {
        var type = el.value;
        var essence = type;  // embedded → 'embedded', wav → 'external', mxf → 'mxf'
        if (type === 'wav') essence = 'external';
        SETTINGS.essence = essence;
        saveSettings();
        document.querySelectorAll('.export-option').forEach(function(o) { o.classList.remove('selected'); });
        el.closest('.export-option').classList.add('selected');
        renderExportTab();
      }

  function buildCLICommand() {
      var routingParts = [];
      ROUTING_DATA.forEach(function(d, i) {
        if (d.group && d.track) {
          routingParts.push(i + ':' + d.track);
        }
      });
      var routingStr = routingParts.join(',') || 'all:auto';

    var modeFlag = SETTINGS.mode !== 'group' ? ' --mode ' + SETTINGS.mode : '';
    var essenceFlag = SETTINGS.essence !== 'embedded' ? ' --essence ' + SETTINGS.essence : '';
    var srFlag = SETTINGS.sampleRate !== 'auto' ? ' --samplerate ' + SETTINGS.sampleRate : '';
    var bdFlag = SETTINGS.bitDepth !== 'auto' ? ' --subtype PCM_' + SETTINGS.bitDepth : '';

    var aafDir = SETTINGS.outputAafDir || './output';
        var inPath = _filePath || './source.wav';
        var outName = (_clipName || 'export') + '.aaf';
        var cmd = 'polywav embed-aaf -i ' + inPath + ' -o ' + aafDir + '/' + outName
      + ' --routing "' + routingStr + '"'
      + modeFlag + essenceFlag + srFlag + bdFlag;

    var el = document.getElementById('exportCLI');
    if (el) el.textContent = cmd;
  }

  function browseDir(fieldId) {
      var current = fieldId === 'outputAafDir' ? SETTINGS.outputAafDir : SETTINGS.outputMxfDir;
      var label = fieldId === 'outputAafDir' ? 'output folder' : 'MXF folder';
      // Use Electron dialog if available
      if (window.electronAPI && window.electronAPI.openDirectoryWithDefault) {
        window.electronAPI.openDirectoryWithDefault(current).then(function(chosen) {
          if (!chosen) return;
          if (fieldId === 'outputAafDir') SETTINGS.outputAafDir = chosen;
          else SETTINGS.outputMxfDir = chosen;
          saveSettings();
          syncSettingsUI();
          buildCLICommand();
          updateAafPreview();
          showToast('Output ' + (fieldId === 'outputAafDir' ? 'AAF' : 'MXF') + ' folder updated');
        });
      } else {
        var chosen = prompt('Enter the full path for the ' + label + ':', current);
        if (chosen !== null && chosen.trim()) {
          if (fieldId === 'outputAafDir') SETTINGS.outputAafDir = chosen.trim();
          else SETTINGS.outputMxfDir = chosen.trim();
          saveSettings();
          syncSettingsUI();
          buildCLICommand();
          updateAafPreview();
          showToast('Output ' + (fieldId === 'outputAafDir' ? 'AAF' : 'MXF') + ' folder updated');
        }
      }
    }

  function updateAafPreview() {
      var el = document.getElementById('outputAafPreview');
      if (el) {
        el.textContent = (SETTINGS.outputAafDir || './output') + '/' + (_clipName || 'export') + '.aaf';
      }
    }

  function doExport() {
        if (!_fileLoaded) {
          showToast('Load a polywav file on the Home tab first');
          return;
        }
        if (_exporting) {
          showToast('Export already in progress');
          return;
        }

        // Clear log + show progress
        _exportLog = [];
        renderExportLog();
        showExportProgress(true);
        setExportBadge('running', 'running');

        buildCLICommand();

      // Collect config from settings
            var routingParts = [];
            ROUTING_DATA.forEach(function(d, i) {
              if (d.group && d.track) {
                routingParts.push(i + ':' + d.track);
              }
            });
            var routingStr = routingParts.join(',') || '';

            var config = {
              inputPath: _filePath,
              outputPath: (SETTINGS.outputAafDir || './output') + '/' + (_clipName || 'export') + '.aaf',
              clipName: _clipName || 'export',
              routing: routingStr || undefined,
              mode: SETTINGS.mode !== 'group' ? SETTINGS.mode : undefined,
              sampleRate: SETTINGS.sampleRate !== 'auto' ? parseInt(SETTINGS.sampleRate, 10) : undefined,
              subtype: SETTINGS.bitDepth !== 'auto' ? 'PCM_' + SETTINGS.bitDepth : undefined,
              essence: SETTINGS.essence !== 'embedded' ? SETTINGS.essence : undefined,
            };

      // Try to start export via IPC
      if (window.electronAPI && window.electronAPI.exportStart) {
        window.electronAPI.exportStart(config).then(function(result) {
          if (result.error) {
            // N-8: failed start must not leave the progress UI stuck "running"
            _exporting = false;
            updateExportButton(false);
            showExportProgress(false);
            setExportBadge('ready', 'error');
            showToast('Export error: ' + result.error);
            return;
          }
          _exporting = true;
          switchTab('export');
          showToast('Export started');
          addExportLog('Export started: ' + (config.clipName || ''), 'info');
          updateExportButton(true);
        }).catch(function(err) {
          // N-8: rejected start resets the progress UI too
          _exporting = false;
          updateExportButton(false);
          showExportProgress(false);
          setExportBadge('ready', 'error');
          showToast('Failed to start export: ' + err.message);
        });
      } else {
        // Fallback (no Electron): copy CLI command
        var el = document.getElementById('exportCLI');
        if (el && el.textContent && el.textContent.indexOf('polywav') > 0) {
          navigator.clipboard.writeText(el.textContent).catch(function() {});
          showToast('CLI command copied to clipboard');
        }
        switchTab('export');
      }
    }

    // Keep exportCLI as alias for backwards compatibility
    var exportCLI = doExport;

    function copyCLI() {
    var el = document.getElementById('exportCLI');
    if (!el || !el.textContent) return;
    try {
      navigator.clipboard.writeText(el.textContent).then(function() {
        showToast('CLI command copied');
      });
    } catch(e) {
      // Fallback: select and copy
      var range = document.createRange();
      range.selectNode(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.execCommand('copy');
      window.getSelection().removeAllRanges();
      showToast('CLI command copied');
    }
  }

    // ---- Export Helpers ------------------------------------------------------
    function addExportLog(msg, type) {
      type = type || 'info';
      _exportLog.push({ msg: msg, type: type, time: new Date().toLocaleTimeString() });
      renderExportLog();
    }

    function renderExportLog() {
      var el = document.getElementById('exportLog');
      if (!el) return;
      el.innerHTML = _exportLog.map(function(entry) {
        var cls = 'export-log-' + entry.type;
        return '<div class="' + cls + '"><span class="export-log-time">' + entry.time + '</span> ' + escapeHtml(entry.msg) + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }

    function escapeHtml(str) {
          var div = document.createElement('div');
          div.appendChild(document.createTextNode(str));
          return div.innerHTML;
        }

        function showExportProgress(show) {
          var el = document.getElementById('exportProgress');
          if (el) el.style.display = show ? '' : 'none';
        }

        function setExportBadge(state, label) {
          var el = document.getElementById('exportStatusBadge');
          if (!el) return;
          el.className = 'badge' + (state !== 'ready' ? ' ' + state : '');
          el.textContent = label || state;
        }

        function updateExportButton(running) {
              var btn = document.getElementById('exportBtn');
              if (!btn) return;
              if (running) {
                btn.textContent = '\u2716 Cancel Export';
                btn.onclick = cancelExport;
              } else {
                btn.textContent = '\u21E9 Export for Avid';
                btn.onclick = doExport;
              }
            }

    function cancelExport() {
          if (window.electronAPI && window.electronAPI.exportCancel) {
            window.electronAPI.exportCancel().then(function(result) {
              if (result.ok) {
                showToast('Export cancelled');
                addExportLog('Export cancelled by user', 'warn');
              }
              _exporting = false;
              updateExportButton(false);
              showExportProgress(false);
              setExportBadge('ready', 'cancelled');
            });
          } else {
            _exporting = false;
            updateExportButton(false);
            showExportProgress(false);
            setExportBadge('ready', 'cancelled');
          }
        }

    // ---- IPC Event Wiring (Electron only) ------------------------------------
    if (window.electronAPI) {
      // Maximize-state listener registered ONCE at boot (was per button
      // click, stacking another ipcRenderer.on callback every time).
      if (window.electronAPI.onMaximizeChange) {
        window.electronAPI.onMaximizeChange(function(maximized) {
          var btn = document.getElementById('maxBtn');
          if (!btn) return;
          btn.textContent = maximized ? '\u2750' : '\u25A1';
          btn.title = maximized ? 'Restore' : 'Maximize';
        });
      }
      window.electronAPI.onExportProgress(function(data) {
        addExportLog(data.line || data, 'stdout');
      });
      window.electronAPI.onExportComplete(function(result) {
              _exporting = false;
              updateExportButton(false);
              showExportProgress(false);
              setExportBadge('success', 'complete');
              addExportLog('Export complete: ' + result.outputPath, 'success');
              showToast('Export complete');
            });
            window.electronAPI.onExportError(function(err) {
              _exporting = false;
              updateExportButton(false);
              showExportProgress(false);
              setExportBadge('error', 'failed');
              addExportLog('Export error: ' + (err.message || err.stderr || 'Unknown error'), 'error');
              showToast('Export failed');
            });
            if (window.electronAPI.onExportCancelled) {
              window.electronAPI.onExportCancelled(function() {
                // Main process confirms the cancelled child exited
                _exporting = false;
                updateExportButton(false);
                showExportProgress(false);
                setExportBadge('ready', 'cancelled');
                addExportLog('Export cancelled', 'warn');
              });
            }
    }

    // Initial snapshot
  pushSnapshot();

  function renderRoutingMap() {
    var wrap = document.getElementById('patchMapWrap');
    var srcList = document.getElementById('patchSrcList');
    var groupsEl = document.getElementById('patchGroups');
    var unroutedChips = document.getElementById('patchUnroutedChips');
    var svgEl = document.getElementById('patchSvgEl');
    if (!wrap || !srcList || !groupsEl || !svgEl) return;

    // Render source chips
        var srcHtml = '';
        ROUTING_DATA.forEach(function(d) {
          var assigned = d.group !== null;
          var chNum = parseInt(d.ch, 10);
          var normName = getNormNameForChannel(chNum - 1);
         srcHtml += '<div class="patch-src' + (assigned ? '' : ' unrouted') + '" draggable="true" data-ch="' + esc(d.ch) + '">'
            + '<span class="src-dot" style="background:' + (assigned ? d.color : '#ccc') + '"></span> '
            + '<span class="src-ch">Ch ' + esc(d.ch) + '</span>'
            + '<span class="src-name">' + esc(normName) + '</span>'
            + '<span class="src-rename" title="Rename">&#9998;</span>'
            + '</div>';
    });
    srcList.innerHTML = srcHtml;

    // Render groups
        var groupsHtml = '';
        var orderedGroups = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
    orderedGroups.forEach(function(g) {
      var info = GROUP_INFO[g];
      var tracksHtml = '';
      info.tracks.forEach(function(t) {
        var count = ROUTING_DATA.filter(function(d) { return d.track === t; }).length;
        tracksHtml += '<div class="grp-track" data-track="' + t + '">'
          + '<span style="width:8px;height:8px;border-radius:50%;background:' + info.color + ';flex-shrink:0;"></span>'
          + t
          + (count > 0 ? '<span class="grp-count">' + count + ' ch</span>' : '')
          + '</div>';
      });
      groupsHtml += '<div class="patch-group" data-group="' + g + '" style="--grp-color:' + info.color + '">'
        + '<div class="grp-label">' + info.label + '</div>'
        + '<div class="grp-name">' + info.name + '</div>'
        + '<div class="grp-tracks">' + tracksHtml + '</div>'
        + '</div>';
    });
    groupsEl.innerHTML = groupsHtml;

    // Render unassigned chips
    var unrouted = ROUTING_DATA.filter(function(d) { return d.group === null; });
    if (unrouted.length > 0) {
      document.getElementById('patchUnrouted').style.display = 'block';
      var chipsHtml = '';
      unrouted.forEach(function(d) {
              var chNum = parseInt(d.ch, 10);
              var normName = getNormNameForChannel(chNum - 1);
              chipsHtml += '<span class="unrouted-chip">Ch ' + d.ch + ' ' + normName + '</span>';
      });
      unroutedChips.innerHTML = chipsHtml;
    } else {
      document.getElementById('patchUnrouted').style.display = 'none';
    }

    // Draw SVG paths (after layout)
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        drawFlowPaths(wrap, svgEl);
      });
    });
  }

  function drawFlowPaths(wrap, svgEl) {
    var wrapRect = wrap.getBoundingClientRect();
    var srcEls = wrap.querySelectorAll('.patch-src');
    var trackEls = wrap.querySelectorAll('.grp-track');

    if (srcEls.length === 0 || trackEls.length === 0) return;

    svgEl.setAttribute('viewBox', '0 0 ' + wrapRect.width + ' ' + wrapRect.height);
    svgEl.setAttribute('width', wrapRect.width);
    svgEl.setAttribute('height', wrapRect.height);

    var paths = [];
    var midX = wrapRect.width * 0.42;

    ROUTING_DATA.forEach(function(d) {
      var srcEl = wrap.querySelector('.patch-src[data-ch="' + d.ch + '"]');
      if (!srcEl) return;

      var srcRect = srcEl.getBoundingClientRect();
      var x1 = srcRect.right - wrapRect.left;
      var y1 = srcRect.top + srcRect.height / 2 - wrapRect.top;

      if (d.group) {
        var trackEl = wrap.querySelector('.grp-track[data-track="' + d.track + '"]');
        if (!trackEl) return;
        var trRect = trackEl.getBoundingClientRect();
        var x2 = trRect.left - wrapRect.left;
        var y2 = trRect.top + trRect.height / 2 - wrapRect.top;
        var cx1 = midX;
        var cx2 = midX;
        var pathD = 'M ' + x1 + ' ' + y1 + ' C ' + cx1 + ' ' + y1 + ', ' + cx2 + ' ' + y2 + ', ' + x2 + ' ' + y2;
        paths.push({ d: pathD, color: d.color, unrouted: false });
      } else {
        // Unassigned: flow to the right side (unrouted box area)
        var x2 = wrapRect.width * 0.75;
        var y2 = wrapRect.height * 0.88 + 12;
        var cx1 = midX;
        var cx2 = midX + 40;
        var pathD = 'M ' + x1 + ' ' + y1 + ' C ' + cx1 + ' ' + y1 + ', ' + cx2 + ' ' + y2 + ', ' + x2 + ' ' + y2;
        paths.push({ d: pathD, color: '#ccc', unrouted: true });
      }
    });

    var html = '';
    paths.forEach(function(p, idx) {
      html += '<path class="patch-flow' + (p.unrouted ? ' unrouted' : '') + '" d="' + p.d + '" stroke="' + p.color + '" data-ch="' + ROUTING_DATA[idx].ch + '"/>';
    });
    svgEl.innerHTML = html;
  }

  // ===== Patch tab: Drag-and-drop patching + reordering =====
  var dragSrcCh = null;
  var tempCableTimer = null;

  // Sample points along a cubic bezier path for hit testing
  function sampleBezier(d, numPoints) {
    var parts = d.split(' ');
    if (parts.length < 10) return [];
    var x1 = parseFloat(parts[1]), y1 = parseFloat(parts[2]);
    var cx1 = parseFloat(parts[4].replace(',','')), cy1 = parseFloat(parts[5].replace(',',''));
    var cx2 = parseFloat(parts[6].replace(',','')), cy2 = parseFloat(parts[7].replace(',',''));
    var x2 = parseFloat(parts[8].replace(',','')), y2 = parseFloat(parts[9].replace(',',''));
    var pts = [];
    for (var i = 0; i <= numPoints; i++) {
      var t = i / numPoints, mt = 1 - t;
      pts.push([
        mt*mt*mt*x1 + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*x2,
        mt*mt*mt*y1 + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*y2
      ]);
    }
    return pts;
  }

  function getTempCableSvg() {
    return document.querySelector('#patchSvgEl');
  }

  function createTempCable(srcCh) {
    var svg = getTempCableSvg();
    if (!svg) return;
    var wrap = document.getElementById('patchMapWrap');
    if (!wrap) return;
    var wrapRect = wrap.getBoundingClientRect();
    var srcEl = wrap.querySelector('.patch-src[data-ch="' + srcCh + '"]');
    if (!srcEl) return;
    var srcRect = srcEl.getBoundingClientRect();
    var x1 = srcRect.right - wrapRect.left;
    var y1 = srcRect.top + srcRect.height / 2 - wrapRect.top;
    var midX = wrapRect.width * 0.42;
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('class', 'patch-flow patch-temp-cable');
    el.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + (midX + 40) + ' ' + y1 + ', ' + (midX + 80) + ' ' + y1);
    el.setAttribute('stroke', '#c4664a');
    svg.appendChild(el);
  }

  function updateTempCable(e) {
    var svg = getTempCableSvg();
    var wrap = document.getElementById('patchMapWrap');
    if (!svg || !wrap) return;
    var temp = svg.querySelector('.patch-temp-cable');
    if (!temp) return;
    var wrapRect = wrap.getBoundingClientRect();
    var ex = e.clientX - wrapRect.left;
    var ey = e.clientY - wrapRect.top;
    // Keep starting point, update cubic endpoint to cursor
    var parts = temp.getAttribute('d').split(' ');
    var x1 = parts[1], y1_ = parts[2];
    var midX = wrapRect.width * 0.42;
    var newD = 'M ' + x1 + ' ' + y1_ + ' C ' + midX + ' ' + y1_ + ', ' + ex + ' ' + ey + ', ' + ex + ' ' + ey;
    temp.setAttribute('d', newD);
    // Color by hover target
    var track = e.target.closest('.grp-track');
    var unroute = e.target.closest('#patchUnrouted');
    if (track) {
      var groupEl = track.closest('.patch-group');
      var groupKey = groupEl ? groupEl.getAttribute('data-group') : null;
      var info = groupKey ? GROUP_INFO[groupKey] : null;
      temp.setAttribute('stroke', info ? info.color : '#c4664a');
      temp.setAttribute('opacity', '0.9');
    } else if (unroute) {
      temp.setAttribute('stroke', '#ccc');
      temp.setAttribute('opacity', '0.9');
    } else {
      temp.setAttribute('stroke', '#c4664a');
      temp.setAttribute('opacity', '0.5');
    }
  }

  function removeTempCable() {
    var svg = getTempCableSvg();
    if (!svg) return;
    var temp = svg.querySelector('.patch-temp-cable');
    if (temp) temp.remove();
  }

  function setupPatchDnD() {
    var wrap = document.getElementById('patchMapWrap');
    if (!wrap) return;

    // Drag start (delegated)
    wrap.addEventListener('dragstart', function(e) {
      var src = e.target.closest('.patch-src');
      if (!src) { e.preventDefault(); return; }
      dragSrcCh = src.getAttribute('data-ch');
      e.dataTransfer.setData('text/plain', dragSrcCh);
      e.dataTransfer.effectAllowed = 'move';
      src.classList.add('dragging');
      // Hide default drag ghost (use transparent 1x1 gif)
      var blank = new Image();
      blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(blank, 0, 0);
      // Draw live cable
      createTempCable(dragSrcCh);
    });

    wrap.addEventListener('dragend', function(e) {
      var src = e.target.closest('.patch-src');
      if (src) src.classList.remove('dragging');
      wrap.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
      removeTempCable();
      dragSrcCh = null;
    });

    // Drag over
    wrap.addEventListener('dragover', function(e) {
      if (!dragSrcCh) return;

      var track = e.target.closest('.grp-track');
      if (track) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        track.classList.add('drag-over');
        updateTempCable(e);
        return;
      }

      var unroute = e.target.closest('#patchUnrouted');
      if (unroute) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        unroute.classList.add('drag-over');
        updateTempCable(e);
        return;
      }

      var targetSrc = e.target.closest('.patch-src');
      if (targetSrc && targetSrc.getAttribute('data-ch') !== dragSrcCh) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        targetSrc.classList.add('drag-over');
        updateTempCable(e);
        return;
      }

      // Still update cable when hovering over empty space
      updateTempCable(e);
    });

    // Drag leave
    wrap.addEventListener('dragleave', function(e) {
      var el = e.target.closest('.grp-track, #patchUnrouted, .patch-src');
      if (el) el.classList.remove('drag-over');
    });

    // Drop
    wrap.addEventListener('drop', function(e) {
      e.preventDefault();
      removeTempCable();
      wrap.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
      var ch = e.dataTransfer.getData('text/plain') || dragSrcCh;
      if (!ch) return;

      var entry = null, entryIdx = -1;
      for (var i = 0; i < ROUTING_DATA.length; i++) {
        if (ROUTING_DATA[i].ch === ch) { entry = ROUTING_DATA[i]; entryIdx = i; break; }
      }
      if (!entry) return;

      // Dropped on a destination track -> assign/patch
      var track = e.target.closest('.grp-track');
      if (track) {
        var trackName = track.getAttribute('data-track');
        var groupEl = track.closest('.patch-group');
        var groupKey = groupEl ? groupEl.getAttribute('data-group') : null;
        var groupInfo = groupKey ? GROUP_INFO[groupKey] : null;
        if (groupInfo) {
          entry.group = groupKey;
          entry.track = trackName;
          entry.color = groupInfo.color;
          pushSnapshot();
          rerenderAll();
          showToast('Patched: Ch ' + entry.ch + ' → ' + trackName);
        }
        return;
      }

      // Dropped on a source item -> reorder (swap)
      var targetSrc = e.target.closest('.patch-src');
      if (targetSrc && targetSrc.getAttribute('data-ch') !== ch) {
        var targetCh = targetSrc.getAttribute('data-ch');
        var tgtIdx = -1;
        for (var i = 0; i < ROUTING_DATA.length; i++) {
          if (ROUTING_DATA[i].ch === targetCh) { tgtIdx = i; break; }
        }
        if (tgtIdx >= 0) {
          var temp = ROUTING_DATA[entryIdx];
          ROUTING_DATA[entryIdx] = ROUTING_DATA[tgtIdx];
          ROUTING_DATA[tgtIdx] = temp;
          pushSnapshot();
          rerenderAll();
        }
        return;
      }

      // Dropped on unassigned box -> unassign
      var unroute = e.target.closest('#patchUnrouted');
      if (unroute && entry.group !== null) {
        entry.group = null;
        entry.track = null;
        entry.color = '#ccc';
        pushSnapshot();
        rerenderAll();
        showToast('Unpatched: Ch ' + entry.ch);
        return;
      }
    });

    // ===== Click a cable to unassign the patch =====
    wrap.addEventListener('click', function(e) {
      // Don't interfere with rename clicks, track clicks, or lane clicks
      if (e.target.closest('.src-rename, .grp-track, .patch-group, .patch-lane, .patch-drag-hint, #patchUnrouted')) return;
      if (e.target.closest('.patch-src')) return;

      var svg = document.getElementById('patchSvgEl');
      if (!svg) return;
      var wrapRect = wrap.getBoundingClientRect();
      var cx = e.clientX - wrapRect.left;
      var cy = e.clientY - wrapRect.top;
      var paths = svg.querySelectorAll('path.patch-flow:not(.unrouted)');
      var hitCh = null;
      var minDist = 8;

      paths.forEach(function(path) {
        var d = path.getAttribute('d');
        if (!d) return;
        var pts = sampleBezier(d, 20);
        for (var i = 0; i < pts.length; i++) {
          var dx = cx - pts[i][0], dy = cy - pts[i][1];
          var dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < minDist) { minDist = dist; hitCh = path.getAttribute('data-ch'); }
        }
      });

      if (hitCh) {
        for (var i = 0; i < ROUTING_DATA.length; i++) {
          if (ROUTING_DATA[i].ch === hitCh && ROUTING_DATA[i].group !== null) {
            ROUTING_DATA[i].group = null;
            ROUTING_DATA[i].track = null;
            ROUTING_DATA[i].color = '#ccc';
            pushSnapshot();
            rerenderAll();
            showToast('Unpatched: Ch ' + hitCh);
            break;
          }
        }
      }
    });

    // Rename via pencil icon
    wrap.addEventListener('click', function(e) {
      var rename = e.target.closest('.src-rename');
      if (!rename) return;
      var src = rename.closest('.patch-src');
      if (!src) return;
      var nameEl = src.querySelector('.src-name');
      if (!nameEl) return;
      nameEl.setAttribute('contenteditable', 'true');
      nameEl.focus();
      var range = document.createRange();
      range.selectNodeContents(nameEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Commit rename on Enter / blur / Escape
    wrap.addEventListener('keydown', function(e) {
      var nameEl = e.target.closest('.src-name');
      if (!nameEl || !nameEl.hasAttribute('contenteditable')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        nameEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        var ch = nameEl.closest('.patch-src').getAttribute('data-ch');
        for (var i = 0; i < ROUTING_DATA.length; i++) {
          if (ROUTING_DATA[i].ch === ch) { nameEl.textContent = getNormNameForChannel(parseInt(ch, 10) - 1); break; }
        }
        nameEl.blur();
      }
    });

    wrap.addEventListener('focusout', function(e) {
          var nameEl = e.target.closest('.src-name');
          if (!nameEl || !nameEl.hasAttribute('contenteditable')) return;
          nameEl.removeAttribute('contenteditable');
          var val = nameEl.textContent.trim();
          var ch = nameEl.closest('.patch-src').getAttribute('data-ch');
          for (var i = 0; i < ROUTING_DATA.length; i++) {
            if (ROUTING_DATA[i].ch === ch) {
              var chIdx = parseInt(ROUTING_DATA[i].ch, 10) - 1;
              var chData = rawChannels[chIdx];
              if (chData) {
                var old = chData.raw;
                if (val && val !== old) {
                  chData.raw = val;
                  chData.caps = parseName(val);
                  pushSnapshot();
                  showToast('Renamed: ' + old + ' → ' + val);
                  rerenderAll();
                }
              }
              break;
            }
          }
        });

    // Allow dropping onto right lane background -> unassign tracks
    var rightLane = wrap.querySelector('.patch-lane:last-child');
    if (rightLane) {
      rightLane.addEventListener('dragover', function(e) {
        if (dragSrcCh) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
      });
      rightLane.addEventListener('drop', function(e) {
        removeTempCable();
        var ch = e.dataTransfer.getData('text/plain') || dragSrcCh;
        if (!ch) return;
        for (var i = 0; i < ROUTING_DATA.length; i++) {
          if (ROUTING_DATA[i].ch === ch && ROUTING_DATA[i].group !== null) {
            ROUTING_DATA[i].group = null;
            ROUTING_DATA[i].track = null;
            ROUTING_DATA[i].color = '#ccc';
            pushSnapshot();
            rerenderAll();
            showToast('Unpatched: Ch ' + ch);
            break;
          }
        }
      });
    }
  }

  // Init routing map on first patch tab visit
  if (document.getElementById('tab-patch').classList.contains('active')) {
    setTimeout(renderRoutingMap, 100);
  }

  // Init drag-and-drop
  setupPatchDnD();

  // Init route tab
  if (document.getElementById('tab-route').classList.contains('active')) {
    setTimeout(renderRouteTab, 100);
  }

  // Init on load
  updateParseTable();
  updateEmptyStates();

  // ===== Settings state (persisted to localStorage) =====
    var SETTINGS_KEY = 'polywav-settings';
    var RECENT_KEY = 'polywav-recent';
    var DEFAULT_SETTINGS = {
    mode: 'group',            // 'group' | 'sequence' | 'mixed'
    essence: 'embedded',      // 'embedded' | 'external' | 'mxf'
    sampleRate: 'auto',       // 'auto' | '48000' | '96000' | '192000'
    bitDepth: '24',           // 'auto' | '16' | '24' | '32'
    presetName: 'Masterchef Kitchens (MKR)',
    namingTemplate: '{prefix}_{role}_{num}',
    mixGain: -3,
    outputAafDir: './output',
    outputMxfDir: './output/mxf',
    showRawBext: true,
    autoAssign: true,
    showToasts: true,
    confirmExport: true,
  };
  var SETTINGS = {};

  function loadSettings() {
    var merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    var saved = null;
    try { saved = localStorage.getItem(SETTINGS_KEY); } catch (e) {}
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        for (var k in DEFAULT_SETTINGS) {
          if (parsed[k] !== undefined) merged[k] = parsed[k];
        }
      } catch (e) {}
    }
    SETTINGS = merged;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) {}
  }
  // Generic handler for every wired control in the settings panel
  function onSettingChange(key, value) {
    SETTINGS[key] = value;
    saveSettings();
  }
  // Refresh all settings controls from SETTINGS (used on open + after import)
  function syncSettingsUI() {
      var sr = document.getElementById('srSelect');       if (sr) sr.value = SETTINGS.sampleRate;
      var bd = document.getElementById('bdSelect');       if (bd) bd.value = SETTINGS.bitDepth;
      var ns = document.getElementById('namingTemplateInput'); if (ns) ns.value = SETTINGS.namingTemplate;
      var ps = document.getElementById('presetSelect');   if (ps) ps.value = SETTINGS.presetName;
      var rb = document.getElementById('rawBextToggle');  if (rb) rb.checked = SETTINGS.showRawBext;
      var tt = document.getElementById('toastToggle');    if (tt) tt.checked = SETTINGS.showToasts;
      var oa = document.getElementById('outputAafDir');   if (oa) oa.value = SETTINGS.outputAafDir;
      var om = document.getElementById('outputMxfDir');   if (om) om.value = SETTINGS.outputMxfDir;
    // Segmented controls: active state now read from data attributes
    // (the CSP migration replaced the old setMode/setEssence handler attrs)
    document.querySelectorAll('.settings-section .segmented').forEach(function(seg) {
      var btns = seg.querySelectorAll('.seg-option');
      btns.forEach(function(b) {
        var mode = b.getAttribute('data-setmode');
        var essence = b.getAttribute('data-setessence');
        var active = (mode !== null && mode === SETTINGS.mode) ||
                     (essence !== null && essence === SETTINGS.essence);
        b.classList.toggle('active', active);
      });
    });
  }
  function onPresetChange(name) {
    SETTINGS.presetName = name;
    saveSettings();
    showToast('Preset: ' + name);
  }

  // Replace the mock setMode/setEssence with state-backed versions
  function setMode(el, mode) {
    SETTINGS.mode = mode;
    saveSettings();
    el.parentElement.querySelectorAll('.seg-option').forEach(function(o) { o.classList.remove('active'); });
    el.classList.add('active');
    showToast('Output: ' + (mode === 'group' ? 'Group Clip' : mode === 'sequence' ? 'Sequence' : 'Mixed'));
  }
  function setEssence(el, type) {
    SETTINGS.essence = type;
    saveSettings();
    el.parentElement.querySelectorAll('.seg-option').forEach(function(o) { o.classList.remove('active'); });
    el.classList.add('active');
    showToast('Media: ' + (type === 'embedded' ? 'Embedded in AAF' : type === 'external' ? 'Separate WAV files' : 'Avid MXF (OP-Atom)'));
  }
  function applySettings() {
    saveSettings();
    toggleSettings();
    showToast('Settings applied · ' + SETTINGS.mode + ' / ' + SETTINGS.essence);
  }

  // ===== Preset YAML export / import =====
  // Build a preset object in the backend ShowPreset schema from the
  // current ROUTING_DATA + SETTINGS.
  function buildPresetData() {
      var tracks = ROUTING_DATA.map(function(d, idx) {
        var t = {
          source_channel: parseInt(d.ch, 10),
          target_track: idx + 1,
          label: getNormNameForChannel(parseInt(d.ch, 10) - 1),
          role: 'iso',
          type: 'unknown',
        };
        if (d.track) {
          t.target_track_label = d.track;
        }
        return t;
      });
    return {
      name: SETTINGS.presetName,
      source: { format: 'polywav', channels: ROUTING_DATA.length, recorder: 'sounddevices' },
      tracks: tracks,
      output: {
        format: 'aaf',
        essence_mode: SETTINGS.essence,
        structure_mode: SETTINGS.mode,
        mix_gain_db: SETTINGS.mixGain,
        track_naming: { template: SETTINGS.namingTemplate, suffix: '' },
      },
    };
  }

  function yamlScalar(v) {
    if (typeof v === 'string') {
      if (/^[A-Za-z0-9_\-.\/ ]+$/.test(v)) return v;
      return JSON.stringify(v);
    }
    return String(v);
  }
  function yamlDump(obj, indent) {
    indent = indent || 0;
    var pad = ' '.repeat(indent);
    var lines = [];
    Object.keys(obj).forEach(function(k) {
      var v = obj[k];
      if (Array.isArray(v)) {
        lines.push(pad + k + ':');
        v.forEach(function(item) {
          if (item && typeof item === 'object') {
            lines.push(pad + '  -');
            yamlDump(item, indent + 4).forEach(function(l) { lines.push(l); });
          } else {
            lines.push(pad + '  - ' + yamlScalar(item));
          }
        });
      } else if (v && typeof v === 'object') {
        lines.push(pad + k + ':');
        yamlDump(v, indent + 2).forEach(function(l) { lines.push(l); });
      } else {
        lines.push(pad + k + ': ' + yamlScalar(v));
      }
    });
    return lines;
  }
  // Minimal YAML parser for the preset schema (nested maps + lists of maps).
  function yamlParse(text) {
    var lines = text.split(/\r?\n/).filter(function(l) { return l.trim() && l.trim()[0] !== '#'; });
    var pos = 0;
    function parseValue(s) {
      s = s.trim();
      if (s === 'true') return true;
      if (s === 'false') return false;
      if (/^-?\d+$/.test(s)) return parseInt(s, 10);
      if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
      if (s[0] === '"') { try { return JSON.parse(s); } catch(e) { return s.slice(1,-1); } }
      if (s[0] === "'") { return s.slice(1,-1).replace(/''/g, "'"); }
      return s;
    }
    // Parse a block of lines at the given indent level.
    function parseBlock(indent) {
      var node = null;
      var isList = false;
      while (pos < lines.length) {
        var line = lines[pos];
        var m = line.match(/^(\s*)(.*)$/);
        var cur = m[1].length;
        var content = m[2];
        if (cur < indent) break;
        if (cur > indent) throw new Error('Unexpected indentation at line ' + (pos + 1));
        if (content.charAt(0) === '-') {
          if (!node) { node = []; isList = true; }
          else if (!isList) throw new Error('Mixed map/list at line ' + (pos + 1));
          var rest = content.slice(1).trim();
          if (!rest) {
            // Empty "-" → next lines are the item
            pos++;
            node.push(parseBlock(cur + 2));
          } else {
            var km = rest.match(/^([^:]+):\s*(.*)$/);
            if (km) {
              // "- key: value" → item is a map with one key, possibly more on next lines
              var item = {};
              item[km[1].trim()] = km[2].trim() === '' ? parseBlock(cur + 2) : parseValue(km[2].trim());
              pos++;
              // Parse sibling keys of this map item (deeper indent than the list marker)
              while (pos < lines.length) {
                var l2 = lines[pos];
                var m2 = l2.match(/^(\s*)(.*)$/);
                var c2 = m2[1].length;
                var content2 = m2[2];
                if (c2 <= cur) break; // back to list level or above
                if (content2.charAt(0) === '-' && c2 === cur) break; // next list item
                var kv2 = content2.match(/^([^:]+):\s*(.*)$/);
                if (kv2) {
                  item[kv2[1].trim()] = kv2[2].trim() === '' ? parseBlock(c2 + 2) : parseValue(kv2[2].trim());
                  pos++;
                } else {
                  pos++;
                }
              }
              node.push(item);
            } else {
              pos++;
              node.push(parseValue(rest));
            }
          }
        } else {
          if (!node) { node = {}; isList = false; }
          else if (isList) throw new Error('Mixed list/map at line ' + (pos + 1));
          var kv = content.match(/^([^:]+):\s*(.*)$/);
          if (!kv) { pos++; continue; }
          var key = kv[1].trim();
          var val = kv[2].trim();
          pos++;
          node[key] = val === '' ? parseBlock(cur + 2) : parseValue(val);
        }
      }
      return node || {};
    }
    return parseBlock(0);
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'application/x-yaml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 50);
  }

  function savePreset() {
    var data = buildPresetData();
    var slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'preset';
    downloadText(slug + '.yaml', yamlDump(data).join('\n') + '\n');
    showToast('Preset saved: ' + slug + '.yaml');
  }
  function exportPreset() {
    savePreset();
  }
  function duplicatePreset() {
    var data = buildPresetData();
    var slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'preset';
    downloadText(slug + '_copy.yaml', yamlDump(data).join('\n') + '\n');
    showToast('Preset duplicated: ' + slug + '_copy.yaml');
  }
  function importPreset() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.json';
    input.onchange = function() {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function() {
        try {
          var text = String(reader.result);
          var data = text.trim()[0] === '{' ? JSON.parse(text) : yamlParse(text);
          applyPresetData(data);
          showToast('Preset imported: ' + file.name);
        } catch (e) {
          showToast('Import failed: ' + e.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  function applyPresetData(data) {
      if (data && data.name) { SETTINGS.presetName = data.name; }
      if (data && data.output) {
        if (data.output.essence_mode) SETTINGS.essence = data.output.essence_mode;
        if (data.output.structure_mode) SETTINGS.mode = data.output.structure_mode;
        if (data.output.mix_gain_db !== undefined) SETTINGS.mixGain = Number(data.output.mix_gain_db);
        if (data.output.track_naming && data.output.track_naming.template) {
          SETTINGS.namingTemplate = data.output.track_naming.template;
        }
      }
      saveSettings();
      // Apply routing from preset tracks
      var tracks = (data && data.tracks) || [];
      if (tracks.length) {
        var byCh = {};
        tracks.forEach(function(t) {
          var sc = parseInt(t.source_channel, 10);
          if (!isNaN(sc)) byCh[sc] = t;
        });
        ROUTING_DATA.forEach(function(d) {
                var t = byCh[parseInt(d.ch, 10)];
                if (t) {
                  var chIdx = parseInt(d.ch, 10) - 1;
                  var chData = rawChannels[chIdx];
                  if (chData && t.label) {
                    chData.raw = t.label;
                    chData.caps = parseName(t.label);
                  }
                  // Try to map back to an AO track: use target_track_label
                  var matchedTrack = null;
                  var matchTrack = t.target_track_label || t.track || '';
                  // Search GROUP_INFO tracks for exact match
                  if (matchTrack) {
                    Object.keys(GROUP_INFO).forEach(function(gk) {
                      if (matchedTrack) return;
                      if (GROUP_INFO[gk].tracks.indexOf(matchTrack) >= 0) {
                        matchedTrack = matchTrack;
                      }
                    });
                  }
                  if (matchedTrack) {
                    var aoNum = parseInt(matchedTrack.charAt(0) === 'A' ? matchedTrack.slice(1) : matchedTrack, 10);
                    var colorIdx = Math.floor((aoNum - 1) / 8) % AO_COLORS.length;
                    d.group = 'AO';
                    d.track = matchedTrack;
                    d.color = AO_COLORS[colorIdx];
                  } else {
                    d.group = null;
                    d.track = null;
                    d.color = '#ccc';
                  }
          }
        });
        pushSnapshot();
        rerenderAll();
      }
      syncSettingsUI();
        }

        // ===== Setup Wizard =====
    var WIZARD_TEMPLATES = {
      panel: {
        name: 'Panel Show',
        naming: { template: '{prefix}_{role}_{num}', separator: '_' },
        routing: { autoAssign: true, trackGroup: 'A1-A8', mixGain: -3 },
        export: { mode: 'group', essence: 'embedded', sampleRate: 'auto', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' }
      },
      cooking: {
        name: 'Cooking Show',
        naming: { template: '{prefix}_{role}_{num}', separator: '_' },
        routing: { autoAssign: true, trackGroup: 'A9-A16', mixGain: -3 },
        export: { mode: 'mixed', essence: 'mxf', sampleRate: 'auto', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' }
      },
      music: {
        name: 'Music',
        naming: { template: 'track_{num}_{role}', separator: '_' },
        routing: { autoAssign: false, trackGroup: 'A1-A8', mixGain: 0 },
        export: { mode: 'sequence', essence: 'embedded', sampleRate: '48000', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' }
      },
      custom: {
        name: 'Custom',
        naming: { template: '{prefix}_{role}_{num}', separator: '_' },
        routing: { autoAssign: true, trackGroup: 'A1-A8', mixGain: -3 },
        export: { mode: 'group', essence: 'embedded', sampleRate: 'auto', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' }
      }
    };

    var wizState = {
      step: 0,
      template: null,
      naming: { template: '{prefix}_{role}_{num}', separator: '_' },
      routing: { autoAssign: true, trackGroup: 'A1-A8', mixGain: -3 },
      export: { mode: 'group', essence: 'embedded', sampleRate: 'auto', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' }
    };

    function openWizard() {
      // Reset state if no template selected yet
      if (!wizState.template) {
        wizState.step = 0;
        wizState.template = null;
        wizState.naming = { template: '{prefix}_{role}_{num}', separator: '_' };
        wizState.routing = { autoAssign: true, trackGroup: 'A1-A8', mixGain: -3 };
        wizState.export = { mode: 'group', essence: 'embedded', sampleRate: 'auto', bitDepth: '24', aafDir: './output', mxfDir: './output/mxf' };
      }
      var overlay = document.getElementById('wizardOverlay');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      renderWizard();
    }

    function closeWizard() {
      var overlay = document.getElementById('wizardOverlay');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Close wizard on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('wizardOverlay');
        if (overlay && overlay.classList.contains('open')) closeWizard();
      }
    });

    function selectTemplate(template) {
      wizState.template = template;
      // Highlight card
      document.querySelectorAll('.wizard-tmpl-card').forEach(function(c) {
        c.classList.toggle('selected', c.getAttribute('data-template') === template);
      });
      // Apply defaults
      var tpl = WIZARD_TEMPLATES[template];
      if (tpl) {
        wizState.naming = JSON.parse(JSON.stringify(tpl.naming));
        wizState.routing = JSON.parse(JSON.stringify(tpl.routing));
        wizState.export = JSON.parse(JSON.stringify(tpl.export));
        // Push the fresh defaults into the form inputs NOW. Without this,
        // the next readWizardForm() reads back stale input values and
        // silently overwrites the template the user just picked.
        syncWizardForm();
      }
    }

    function renderWizard() {
      renderStepDots();
      renderStepPanel();
      renderFooter();
    }

    function renderStepDots() {
      var labels = ['Template', 'Naming', 'Routing', 'Export', 'Save'];
      var html = '';
      for (var i = 0; i < 5; i++) {
        // Navigation is delegated from #wizardSteps (attribute handlers are
        // dead under CSP)
        html += '<div class="wizard-step-dot' +
          (i === wizState.step ? ' active' : '') +
          (i < wizState.step ? ' done' : '') +
          '" data-step="' + i + '" role="button" tabindex="0">' +
          '<span class="wizard-dot"></span>' +
          '<span class="wizard-step-label">' + labels[i] + '</span>' +
          '</div>';
        if (i < 4) html += '<span class="wizard-steps-sep"></span>';
      }
      document.getElementById('wizardSteps').innerHTML = html;
    }

    function renderStepPanel() {
      // Hide all panels
      document.querySelectorAll('.wizard-step-panel').forEach(function(p) { p.classList.remove('active'); });
      // Show current
      var panel = document.getElementById('wizStep' + wizState.step);
      if (panel) panel.classList.add('active');

      // Sync form values from state
      syncWizardForm();
    }

    function syncWizardForm() {
      var nt = document.getElementById('wizNamingTemplate');
      if (nt) nt.value = wizState.naming.template;

      var sep = document.getElementById('wizSeparator');
      if (sep) sep.value = wizState.naming.separator;

      var aa = document.getElementById('wizAutoAssign');
      if (aa) aa.checked = wizState.routing.autoAssign;

      var tg = document.getElementById('wizTrackGroup');
      if (tg) tg.value = wizState.routing.trackGroup;

      var mg = document.getElementById('wizMixGain');
      if (mg) mg.value = wizState.routing.mixGain;

      var md = document.getElementById('wizMode');
      if (md) md.value = wizState.export.mode;

      var es = document.getElementById('wizEssence');
      if (es) es.value = wizState.export.essence;

      var sr = document.getElementById('wizSampleRate');
      if (sr) sr.value = wizState.export.sampleRate;

      var bd = document.getElementById('wizBitDepth');
      if (bd) bd.value = wizState.export.bitDepth;

      var ad = document.getElementById('wizAafDir');
      if (ad) ad.value = wizState.export.aafDir;

      var md2 = document.getElementById('wizMxfDir');
      if (md2) md2.value = wizState.export.mxfDir;

      updateNamingPreview();

      // If on step 5 (summary), render summary
      if (wizState.step === 4) renderWizardSummary();
    }

    function updateNamingPreview() {
      var preview = document.getElementById('wizNamingPreview');
      if (!preview) return;
      var sep = wizState.naming.separator;
      var tmpl = wizState.naming.template;
      // Build a sample from the template
      var sample = tmpl
        .replace(/{prefix}/g, 'ISO')
        .replace(/{role}/g, 'Presenter')
        .replace(/{num}/g, '01')
        .replace(/{side}/g, 'L')
        .replace(/_/g, sep)
        .replace(/-/g, sep);
      preview.textContent = sample;
    }

    // Live update naming preview when inputs change
    document.addEventListener('change', function(e) {
      if (e.target.id === 'wizNamingTemplate' || e.target.id === 'wizSeparator') {
        updateNamingPreview();
      }
    });
    document.addEventListener('input', function(e) {
      if (e.target.id === 'wizNamingTemplate' || e.target.id === 'wizSeparator') {
        updateNamingPreview();
      }
    });

    function renderFooter() {
      var left = document.getElementById('wizFooterLeft');
      left.textContent = 'Step ' + (wizState.step + 1) + ' of 5';

      var back = document.getElementById('wizBackBtn');
      back.style.visibility = wizState.step === 0 ? 'hidden' : 'visible';

      var next = document.getElementById('wizNextBtn');
      if (wizState.step === 4) {
        next.textContent = 'Finish';
      } else {
        next.textContent = 'Next';
      }
    }

    function wizardNext() {
      // Validate step 1: must select a template
      if (wizState.step === 0 && !wizState.template) {
        showToast('Please select a project template first');
        return;
      }
      // Collect current form values into state (step 1-3)
      readWizardForm();
      if (wizState.step < 4) {
        wizState.step++;
        renderWizard();
      } else {
        // Finish
        wizardFinish();
      }
    }

    function wizardBack() {
      if (wizState.step > 0) {
        readWizardForm();
        wizState.step--;
        renderWizard();
      }
    }

    function readWizardForm() {
      var nt = document.getElementById('wizNamingTemplate');
      if (nt) wizState.naming.template = nt.value;

      var sep = document.getElementById('wizSeparator');
      if (sep) wizState.naming.separator = sep.value;

      var aa = document.getElementById('wizAutoAssign');
      if (aa) wizState.routing.autoAssign = aa.checked;

      var tg = document.getElementById('wizTrackGroup');
      if (tg) wizState.routing.trackGroup = tg.value;

      var mg = document.getElementById('wizMixGain');
      if (mg) wizState.routing.mixGain = parseFloat(mg.value) || 0;

      var md = document.getElementById('wizMode');
      if (md) wizState.export.mode = md.value;

      var es = document.getElementById('wizEssence');
      if (es) wizState.export.essence = es.value;

      var sr = document.getElementById('wizSampleRate');
      if (sr) wizState.export.sampleRate = sr.value;

      var bd = document.getElementById('wizBitDepth');
      if (bd) wizState.export.bitDepth = bd.value;

      var ad = document.getElementById('wizAafDir');
      if (ad) wizState.export.aafDir = ad.value;

      var md2 = document.getElementById('wizMxfDir');
      if (md2) wizState.export.mxfDir = md2.value;
    }

    function renderWizardSummary() {
      var summary = document.getElementById('wizSummary');
      var tplName = wizState.template ? WIZARD_TEMPLATES[wizState.template].name : 'Custom';
      var modeLabels = { group: 'Group Clip', sequence: 'Sequence', mixed: 'Mixed' };
      var essenceLabels = { embedded: 'Embedded in AAF', external: 'Separate WAV', mxf: 'Avid MXF (OP-Atom)' };
      var html =
        '<div class="wizard-summary-row"><span class="sum-key">Template</span><span class="sum-val">' + tplName + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Naming pattern</span><span class="sum-val" style="font-family:var(--font-mono);font-size:12px;">' + wizState.naming.template + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Separator</span><span class="sum-val" style="font-family:var(--font-mono);">' + (wizState.naming.separator === ' ' ? '&nbsp;(space)' : wizState.naming.separator) + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Auto-assign</span><span class="sum-val">' + (wizState.routing.autoAssign ? 'Yes' : 'No') + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Track group</span><span class="sum-val">' + wizState.routing.trackGroup + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Mix gain</span><span class="sum-val">' + wizState.routing.mixGain + ' dB</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Output structure</span><span class="sum-val">' + (modeLabels[wizState.export.mode] || wizState.export.mode) + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Media format</span><span class="sum-val">' + (essenceLabels[wizState.export.essence] || wizState.export.essence) + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Sample rate</span><span class="sum-val">' + wizState.export.sampleRate + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Bit depth</span><span class="sum-val">' + wizState.export.bitDepth + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">AAF directory</span><span class="sum-val" style="font-family:var(--font-mono);font-size:12px;">' + wizState.export.aafDir + '</span></div>' +
        '<div class="wizard-summary-row"><span class="sum-key">Media directory</span><span class="sum-val" style="font-family:var(--font-mono);font-size:12px;">' + wizState.export.mxfDir + '</span></div>';
      summary.innerHTML = html;
    }

    function wizardFinish() {
      readWizardForm();

      // Apply to SETTINGS
      SETTINGS.namingTemplate = wizState.naming.template;
      // Store separator in namingTemplate too (replaces _ in template)
      SETTINGS.essence = wizState.export.essence;
      SETTINGS.mode = wizState.export.mode;
      SETTINGS.sampleRate = wizState.export.sampleRate;
      SETTINGS.bitDepth = wizState.export.bitDepth;
      SETTINGS.outputAafDir = wizState.export.aafDir;
      SETTINGS.outputMxfDir = wizState.export.mxfDir;
      SETTINGS.mixGain = wizState.routing.mixGain;
      // Record which template was actually used (was stuck on a stale name)
      if (wizState.template && WIZARD_TEMPLATES[wizState.template]) {
        SETTINGS.presetName = WIZARD_TEMPLATES[wizState.template].name;
      }
      saveSettings();

      // Mark wizard as done
            try { localStorage.setItem('polywav-wizard-done', '1'); } catch(e) {}

            closeWizard();
            showToast('Setup complete: ' + (wizState.template ? WIZARD_TEMPLATES[wizState.template].name : 'Custom'));

      // Refresh settings UI
            syncSettingsUI();
          }

          // Load settings + sync UI on boot
          loadSettings();
          syncSettingsUI();
          loadRecentFiles();

          // Auto-show setup wizard on first launch
          (function() {
            try {
              if (!localStorage.getItem('polywav-wizard-done')) {
                setTimeout(openWizard, 300);
              }
            } catch(e) {}
          })();

// ======================================================================
// CSP migration wiring (fix/csp-inline-handlers)
// The strict CSP (script-src 'self') blocks ALL inline event handler
// attributes. Everything below replaces handlers that used to live in
// index.html attributes or generated on*= markup. All referenced
// functions are top-level declarations in this file, so a single boot-
// time block can bind them.
// ======================================================================
(function wireCspMigration() {
  function on(id, ev, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }
  function q(sel, ev, fn) {
    document.querySelectorAll(sel).forEach(function(el) { el.addEventListener(ev, fn); });
  }

  // ---- Window chrome ----
  on('winMinBtn', 'click', minimizeWindow);
  on('maxBtn', 'click', maximizeWindow);
  on('winCloseBtn', 'click', closeWindow);

  // ---- Header ----
  q('[data-nav]', 'click', function() { switchTab(this.getAttribute('data-nav')); });

  // ---- Settings overlay open/close/outside-click/apply ----
  on('settingsToggle', 'click', toggleSettings);
  on('settingsCloseBtn', 'click', toggleSettings);
  on('settingsCancelBtn', 'click', toggleSettings);
  on('settingsApplyBtn', 'click', applySettings);
  on('settingsOverlay', 'click', closeSettingsOutside);

  // Theme segmented control
  q('.seg-option[data-theme]', 'click', function() {
    setThemeFromSettings(this.getAttribute('data-theme'));
  });
  // Mode / essence segmented controls (state-backed setMode/setEssence)
  q('[data-setmode]', 'click', function() { setMode(this, this.getAttribute('data-setmode')); });
  q('[data-setessence]', 'click', function() { setEssence(this, this.getAttribute('data-setessence')); });

  // Settings selects/toggles: persist via onSettingChange / onPresetChange.
  // Bound explicitly by id so the contract tests can trace each control.
  var srSel = document.getElementById('srSelect');
  if (srSel) srSel.addEventListener('change', function() { onSettingChange('sampleRate', this.value); });
  var bdSel = document.getElementById('bdSelect');
  if (bdSel) bdSel.addEventListener('change', function() { onSettingChange('bitDepth', this.value); });
  var presetSel = document.getElementById('presetSelect');
  if (presetSel) presetSel.addEventListener('change', function() { onPresetChange(this.value); });
  var namingTpl = document.getElementById('namingTemplateInput');
  if (namingTpl) namingTpl.addEventListener('change', function() { onSettingChange('namingTemplate', this.value); });
  var rawBext = document.getElementById('rawBextToggle');
  if (rawBext) rawBext.addEventListener('change', function() { onSettingChange('showRawBext', this.checked); });
  var toastTgl = document.getElementById('toastToggle');
  if (toastTgl) toastTgl.addEventListener('change', function() { onSettingChange('showToasts', this.checked); });

  // ---- Export tab ----
  on('outputAafDir', 'change', function() {
    onSettingChange('outputAafDir', this.value);
    buildCLICommand();
  });
  on('outputMxfDir', 'change', function() {
    onSettingChange('outputMxfDir', this.value);
    buildCLICommand();
  });
  on('browseAafDirBtn', 'click', function() { browseDir('outputAafDir'); });
  on('browseMxfDirBtn', 'click', function() { browseDir('outputMxfDir'); });
  on('copyCliBtn', 'click', copyCLI);
  q('input[name="export-format"]', 'click', function() { exportFormatClick(this); });
  on('exportBtn', 'click', doExport);

  // ---- Route / patch tab buttons ----
  on('routeUndoBtn', 'click', undoAction);
  on('routeRedoBtn', 'click', redoAction);
  on('patchUndoBtn', 'click', undoAction);
  on('patchRedoBtn', 'click', redoAction);
  q('[data-toast]', 'click', function() { showToast(this.getAttribute('data-toast')); });

  // ---- Home tab ----
  on('wizardCta', 'click', openWizard);
  on('recentClearBtn', 'click', clearRecent);
  on('flNewBtn', 'click', showDropZone);

  // ---- Normalize inputs ----
  var patternInput = document.getElementById('regex-pattern');
  if (patternInput) patternInput.addEventListener('input', updateParseTable);
  var testRawInput = document.getElementById('test-raw');
  if (testRawInput) testRawInput.addEventListener('input', testRename);

  // ---- Wizard overlay ----
  on('wizardCloseBtn', 'click', closeWizard);
  on('wizBackBtn', 'click', wizardBack);
  on('wizNextBtn', 'click', wizardNext);
  // Outside click closes the wizard (was inline onclick with target check)
  on('wizardOverlay', 'click', function(e) {
    if (e.target === e.currentTarget) closeWizard();
  });
  // Template cards
  q('.wizard-tmpl-card', 'click', function() {
    selectTemplate(this.getAttribute('data-template'));
  });
  q('.wizard-tmpl-card', 'keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    selectTemplate(this.getAttribute('data-template'));
  });
  // Step dots navigation
  var wizSteps = document.getElementById('wizardSteps');
  if (wizSteps) {
    wizSteps.addEventListener('click', function(e) {
      var dot = e.target.closest('.wizard-step-dot');
      if (!dot) return;
      wizState.step = parseInt(dot.getAttribute('data-step'), 10);
      renderWizard();
    });
    wizSteps.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var dot = e.target.closest('.wizard-step-dot');
      if (!dot) return;
      e.preventDefault();
      wizState.step = parseInt(dot.getAttribute('data-step'), 10);
      renderWizard();
    });
  }
  // Wizard form controls -> wizState
  on('wizNamingTemplate', 'change', function() { wizState.naming.template = this.value; });
  on('wizSeparator', 'change', function() { wizState.naming.separator = this.value; });
  on('wizAutoAssign', 'change', function() { wizState.routing.autoAssign = this.checked; });
  on('wizTrackGroup', 'change', function() { wizState.routing.trackGroup = this.value; });
  on('wizMixGain', 'change', function() { wizState.routing.mixGain = parseFloat(this.value); });
  on('wizMode', 'change', function() { wizState.export.mode = this.value; });
  on('wizEssence', 'change', function() { wizState.export.essence = this.value; });
  on('wizSampleRate', 'change', function() { wizState.export.sampleRate = this.value; });
  on('wizBitDepth', 'change', function() { wizState.export.bitDepth = this.value; });
  on('wizAafDir', 'change', function() { wizState.export.aafDir = this.value; });
  on('wizMxfDir', 'change', function() { wizState.export.mxfDir = this.value; });
  // Live naming preview while typing
  on('wizNamingTemplate', 'input', updateNamingPreview);

  // ====================================================================
  // ARIA deepening: roving-tabindex arrow keys + dialog focus traps
  // ====================================================================

  // Arrow-key navigation between tabs (WAI-ARIA tabs pattern)
  var tabBar = document.querySelector('.tab-bar');
  if (tabBar) {
    tabBar.addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' &&
          e.key !== 'Home' && e.key !== 'End') return;
      var tabs = Array.prototype.slice.call(tabBar.querySelectorAll('.tab'));
      var cur = tabs.indexOf(document.activeElement);
      if (cur < 0) cur = tabs.findIndex(function(t) { return t.classList.contains('active'); });
      if (cur < 0) return;
      var next;
      if (e.key === 'ArrowRight') next = (cur + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (cur - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else next = tabs.length - 1;
      e.preventDefault();
      tabs[next].focus();
      switchTab(tabs[next].getAttribute('data-tab'));
    });
  }

  // Focus trap for modal overlays: Tab cycles inside the open dialog and
  // focus is pulled back in if it escapes.
  window.trapFocus = function(overlay) {
    if (!overlay) return null;
    function focusables() {
      return Array.prototype.filter.call(
        overlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        function(el) { return el.offsetParent !== null || el === document.activeElement; }
      );
    }
    function keyHandler(e) {
      if (e.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      } else if (!overlay.contains(document.activeElement)) {
        e.preventDefault(); first.focus();
      }
    }
    overlay.addEventListener('keydown', keyHandler);
    return function releaseTrap() { overlay.removeEventListener('keydown', keyHandler); };
  };

  var _releaseSettingsTrap = trapFocus(document.getElementById('settingsOverlay'));
  var _releaseWizardTrap = trapFocus(document.getElementById('wizardOverlay'));
})();
