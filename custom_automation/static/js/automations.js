/* Custom Automations - HueMix-Link (schema v2) */
(function() {
    'use strict';

    var TRIGGER_DEFS = {
        light_state_change: {
            label: 'Light state change', group: 'Light Events',
            showTarget: true, targetCategory: 'lights',
            triggerProperties: ['on', 'off', 'brightness', 'color'],
            groupTargetByRoom: true,
        },
        room_state_change: {
            label: 'Room/Zone state change', group: 'Room / Zone Events',
            showTarget: true, targetCategory: ['rooms', 'zones'],
            triggerProperties: ['on', 'off', 'brightness', 'scene'],
            groupTargetByType: true,
        },
        motion_detected: {
            label: 'Motion detected', group: 'Sensor Events',
            showTarget: true, targetCategory: 'motion_sensors',
        },
        door_event: {
            label: 'Door event', group: 'Sensor Events',
            showTarget: true, targetCategory: 'door_sensors',
            extraFields: [
                { key: 'door_action', label: 'Action', type: 'select', options: [
                    { value: '', label: 'Any' }, { value: 'opened', label: 'Opened' }, { value: 'closed', label: 'Closed' }
                ]},
            ],
        },
        time_of_day: {
            label: 'Time of day', group: 'System Events', showTarget: false,
            extraFields: [
                { key: 'trigger_time', label: 'Time', type: 'time', defaultValue: '07:00' },
                { key: 'trigger_days', label: 'Days', type: 'day_checkboxes' },
            ],
        },
        startup: {
            label: 'System startup', group: 'System Events', showTarget: false,
        },
    };

    var TRIGGER_TYPE_OPTIONS = [
        { group: 'Light Events', items: [{ value: 'light_state_change', label: 'Light state change' }] },
        { group: 'Room / Zone Events', items: [{ value: 'room_state_change', label: 'Room/Zone state change' }] },
        { group: 'Sensor Events', items: [
            { value: 'motion_detected', label: 'Motion detected' },
            { value: 'door_event', label: 'Door event' },
        ]},
        { group: 'System Events', items: [
            { value: 'time_of_day', label: 'Time of day' },
            { value: 'startup', label: 'System startup' },
        ]},
    ];

    var DAY_NAMES = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    var DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    var COND_CATEGORIES = {
        light:  { label: 'Light',  targetCategory: 'lights' },
        room:   { label: 'Room',   targetCategory: 'rooms' },
        zone:   { label: 'Zone',   targetCategory: 'zones' },
        door:   { label: 'Door',   targetCategory: 'door_sensors', skipProperty: true },
        time:   { label: 'Time',   targetCategory: null, skipProperty: true },
        day:    { label: 'Day',    targetCategory: null, skipProperty: true },
    };

    var COND_PROPERTIES = {
        light: {
            state:     { label: 'State', type: 'select', options: [
                { value: 'on', label: 'is ON' }, { value: 'off', label: 'is OFF' }
            ]},
            brightness: { label: 'Brightness', type: 'compare' },
        },
        room: {
            state:     { label: 'State', type: 'select', options: [
                { value: 'on', label: 'is ON' }, { value: 'off', label: 'is OFF' }
            ]},
            brightness: { label: 'Brightness', type: 'compare' },
            scene:      { label: 'Scene', type: 'scene_select' },
        },
        zone: {
            state:     { label: 'State', type: 'select', options: [
                { value: 'on', label: 'is ON' }, { value: 'off', label: 'is OFF' }
            ]},
            brightness: { label: 'Brightness', type: 'compare' },
            scene:      { label: 'Scene', type: 'scene_select' },
        },
        door: {
            state: { label: 'State', type: 'select', options: [
                { value: 'open', label: 'is open' }, { value: 'closed', label: 'is closed' }
            ]},
        },
        time: {
            range: { label: 'Range', type: 'time_range' },
        },
        day: {
            days: { label: 'Days', type: 'day_checkboxes' },
        },
    };

    var ACTION_CATEGORIES = {
        room:  { label: 'Room',  targetCategory: 'rooms' },
        light: { label: 'Light', targetCategory: 'lights' },
        zone:  { label: 'Zone',  targetCategory: 'zones' },
        delay: { label: 'Delay', targetCategory: null },
        log:   { label: 'Log message', targetCategory: null },
    };

    var ACTION_TYPES = {
        room: [
            { value: 'turn_on',    label: 'Turn ON',    backendType: 'turn_on_room' },
            { value: 'turn_off',   label: 'Turn OFF',   backendType: 'turn_off_room' },
            { value: 'brightness', label: 'Set brightness', backendType: 'set_light_brightness' },
            { value: 'scene',      label: 'Activate scene', backendType: 'call_scene' },
        ],
        light: [
            { value: 'turn_on',    label: 'Turn ON',    backendType: 'set_light_on' },
            { value: 'turn_off',   label: 'Turn OFF',   backendType: 'set_light_off' },
            { value: 'brightness', label: 'Set brightness', backendType: 'set_light_brightness' },
            { value: 'color_temp', label: 'Set color temp', backendType: 'set_light_color' },
        ],
        zone: [
            { value: 'turn_on',    label: 'Turn ON',    backendType: 'turn_on_room' },
            { value: 'turn_off',   label: 'Turn OFF',   backendType: 'turn_off_room' },
            { value: 'brightness', label: 'Set brightness', backendType: 'set_light_brightness' },
            { value: 'scene',      label: 'Activate scene', backendType: 'call_scene' },
        ],
    };

    var ATTR_LABELS = { on: 'On', off: 'Off', brightness: 'Brightness', scene: 'Scene', color: 'Color' };
    var MAX_COND_DEPTH = 3;

    var rules = [];
    var targets = {};
    var editingRuleId = null;
    var deletingRuleId = null;
    var _trigCounter = 0;
    var _branchCounter = 0;
    var _condCounter = 0;
    var _actCounter = 0;
    var _lastRulesSig = null;
    var _lastFiredMap = {};

    function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + (++_condCounter); }

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function formatTime(iso) { try { return new Date(iso).toLocaleString(); } catch(e) { return iso || ''; } }

    function structuralSig(list) {
        return (list || []).map(function(r) {
            var c = {};
            Object.keys(r).forEach(function(k) { if (k !== 'last_fired') c[k] = r[k]; });
            return JSON.stringify(c);
        }).join('|');
    }

    function seedPollCache() {
        _lastRulesSig = structuralSig(rules);
        _lastFiredMap = {};
        rules.forEach(function(r) { _lastFiredMap[r.id] = r.last_fired || null; });
    }

    function flashRuleCard(ruleId) {
        var card = document.querySelector('.rule-card[data-rule-id="' + ruleId + '"]');
        if (!card) return;
        card.classList.remove('flash-press');
        void card.offsetWidth;
        card.classList.add('flash-press');
        setTimeout(function() { card.classList.remove('flash-press'); }, 800);
    }

    function loadRules() {
        fetch('/plugins/automations/api/rules')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                rules = data.rules || [];
                renderRules();
                seedPollCache();
            })
            .catch(function() {
                document.getElementById('rules-container').innerHTML =
                    '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-3"></i><p class="text-red-500">Failed to load rules</p></div>';
            });
    }

    function pollRules() {
        fetch('/plugins/automations/api/rules')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var next = data.rules || [];
                var nextSig = structuralSig(next);
                var nextFired = {};
                next.forEach(function(r) { nextFired[r.id] = r.last_fired || null; });

                var structurallyChanged = nextSig !== _lastRulesSig;
                var newlyFired = [];
                next.forEach(function(r) {
                    if (r.last_fired && _lastFiredMap[r.id] !== undefined && _lastFiredMap[r.id] !== r.last_fired) {
                        newlyFired.push(r.id);
                    }
                });

                if (structurallyChanged || newlyFired.length) {
                    rules = next;
                    renderRules();
                    newlyFired.forEach(flashRuleCard);
                }

                _lastRulesSig = nextSig;
                _lastFiredMap = nextFired;
            })
            .catch(function() { /* ignore poll errors */ });
    }

    function loadTargets() {
        return fetch('/plugins/automations/api/available_targets')
            .then(function(res) { return res.json(); })
            .then(function(data) { targets = data; })
            .catch(function() {
                targets = { lights: [], rooms: [], zones: [], motion_sensors: [], door_sensors: [], scenes: [] };
            });
    }

    function populateSceneSelect(sel, selectedValue, filterGroupId) {
        var cur = sel.value || selectedValue || '';
        sel.innerHTML = '<option value="">Select scene...</option>';
        (targets.scenes || []).forEach(function(s) {
            if (filterGroupId && s.room_id !== filterGroupId) return;
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name || s.id;
            if (s.id === cur) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    function getTargetLabel(id) {
        if (!id) return '';
        var cats = Object.keys(targets);
        for (var i = 0; i < cats.length; i++) {
            var cat = cats[i];
            var items = targets[cat];
            var key = (cat === 'motion_sensors' || cat === 'door_sensors') ? 'mac' : 'id';
            for (var j = 0; j < items.length; j++) {
                if (String(items[j][key]) === String(id)) return items[j].name || id;
            }
        }
        return id.length > 12 ? id.slice(0, 12) + '...' : id;
    }

    function renderDayCheckboxesInto(container, selectedDays, cssColor) {
        if (!container) return;
        var selected = {};
        if (selectedDays) {
            String(selectedDays).split(',').forEach(function(d) { selected[d.trim()] = true; });
        }
        var html = '<div class="flex flex-wrap gap-2">';
        for (var i = 0; i < DAY_NAMES.length; i++) {
            var checked = selected[DAY_NAMES[i]] ? 'checked' : '';
            html += '<label class="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 cursor-pointer hover:bg-gray-100">' +
                '<input type="checkbox" class="day-cb rounded border-gray-300 text-' + cssColor + '-500 focus:ring-' + cssColor + '-500" value="' + DAY_NAMES[i] + '" ' + checked + '> ' +
                DAY_LABELS[i] + '</label>';
        }
        html += '</div>';
        container.innerHTML = html;
    }

    // ===== TRIGGERS (multi, OR) =====

    function buildTriggerTypeSelect(id, selected) {
        var html = '<select class="trig-type border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" onchange="window._onTrigTypeChange(\'' + id + '\')">';
        html += '<option value="">Select event type...</option>';
        TRIGGER_TYPE_OPTIONS.forEach(function(g) {
            html += '<optgroup label="' + esc(g.group) + '">';
            g.items.forEach(function(it) {
                var sel = (selected === it.value) ? ' selected' : '';
                html += '<option value="' + it.value + '"' + sel + '>' + esc(it.label) + '</option>';
            });
            html += '</optgroup>';
        });
        html += '</select>';
        return html;
    }

    function buildTriggerConfigHtml(type, data) {
        var def = TRIGGER_DEFS[type];
        if (!def) return '';
        var html = '';
        if (def.showTarget) {
            html += '<div class="mb-2">' +
                '<label class="block text-xs font-medium text-gray-500 mb-1">Target</label>' +
                '<select class="trig-target w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">' +
                '<option value="">Select target...</option></select></div>';
        }
        if (type === 'light_state_change' || type === 'room_state_change') {
            var props = def.triggerProperties || [];
            var savedAttrs = (data && data.attributes) || [];
            var savedWanted = (data && (data.wanted_state || (data.config && data.config.wanted_state))) || '';
            var savedTP = (data && data.triggerProperties) || null;
            html += '<div class="mb-2">' +
                '<label class="block text-xs font-medium text-gray-500 mb-1">Watch for</label>' +
                '<div class="flex flex-wrap gap-2 trig-props">';
            props.forEach(function(p) {
                var lbl = ATTR_LABELS[p] || p;
                var isChecked = false;
                if (savedTP) isChecked = savedTP.indexOf(p) >= 0;
                else if (p === 'on') isChecked = savedWanted === 'on';
                else if (p === 'off') isChecked = savedWanted === 'off';
                else isChecked = savedAttrs.indexOf(p) >= 0;
                var checked = isChecked ? ' checked' : '';
                html += '<label class="inline-flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 cursor-pointer hover:bg-gray-100">' +
                    '<input type="checkbox" class="trigger-prop-cb rounded border-gray-300 text-amber-500 focus:ring-amber-500" value="' + p + '"' + checked + '> ' + lbl + '</label>';
            });
            html += '</div></div>';
        }
        if (def.extraFields) {
            def.extraFields.forEach(function(f) {
                var cfg = (data && data.config) || data || {};
                html += '<div class="mb-2"><label class="block text-xs font-medium text-gray-500 mb-1">' + esc(f.label) + '</label>';
                if (f.type === 'select') {
                    html += '<select class="trig-extra trig-extra-' + f.key + ' w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" data-key="' + f.key + '">';
                    f.options.forEach(function(o) {
                        var cur = cfg[f.key] != null ? cfg[f.key] : (data && data[f.key]);
                        var sel = (cur === o.value) ? ' selected' : '';
                        html += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
                    });
                    html += '</select>';
                } else if (f.type === 'time') {
                    var val = (cfg[f.key] || (data && data[f.key]) || f.defaultValue || '07:00');
                    html += '<input type="time" class="trig-extra trig-extra-' + f.key + ' w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" data-key="' + f.key + '" value="' + esc(val) + '">';
                } else if (f.type === 'day_checkboxes') {
                    html += '<div class="trig-days mt-1"></div>';
                }
                html += '</div>';
            });
        }
        return html;
    }

    function fillTriggerTarget(sel, type, selectedId) {
        var def = TRIGGER_DEFS[type];
        if (!sel || !def) return;
        sel.innerHTML = '<option value="">Select target...</option>';
        if (!def.showTarget) return;
        var cats = Array.isArray(def.targetCategory) ? def.targetCategory : [def.targetCategory];

        if (def.groupTargetByRoom && cats[0] === 'lights') {
            var roomGroups = {};
            var ungrouped = [];
            (targets.lights || []).forEach(function(item) {
                var rid = item.room_id || '';
                if (rid) {
                    if (!roomGroups[rid]) roomGroups[rid] = [];
                    roomGroups[rid].push(item);
                } else {
                    ungrouped.push(item);
                }
            });
            var allGroups = (targets.rooms || []).concat(targets.zones || []);
            allGroups.forEach(function(g) {
                var lights = roomGroups[g.id];
                if (!lights || !lights.length) return;
                var og = document.createElement('optgroup');
                og.label = g.name || g.id;
                lights.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.id;
                    opt.textContent = item.name || item.id;
                    if (String(item.id) === String(selectedId)) opt.selected = true;
                    og.appendChild(opt);
                });
                sel.appendChild(og);
            });
            if (ungrouped.length) {
                var og2 = document.createElement('optgroup');
                og2.label = 'Other';
                ungrouped.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.id;
                    opt.textContent = item.name || item.id;
                    if (String(item.id) === String(selectedId)) opt.selected = true;
                    og2.appendChild(opt);
                });
                sel.appendChild(og2);
            }
            return;
        }

        cats.forEach(function(cat) {
            if (!cat) return;
            var items = targets[cat] || [];
            var key = (cat === 'motion_sensors' || cat === 'door_sensors') ? 'mac' : 'id';
            if (def.groupTargetByType && cats.length > 1) {
                var og = document.createElement('optgroup');
                og.label = cat === 'zones' ? 'Zones' : 'Rooms';
                items.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item[key];
                    opt.textContent = item.name || item[key];
                    if (String(item[key]) === String(selectedId)) opt.selected = true;
                    og.appendChild(opt);
                });
                sel.appendChild(og);
            } else {
                items.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item[key];
                    opt.textContent = item.name || item[key];
                    if (String(item[key]) === String(selectedId)) opt.selected = true;
                    sel.appendChild(opt);
                });
            }
        });
    }

    window._onTrigTypeChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var type = row.querySelector('.trig-type').value;
        var cfg = row.querySelector('.trig-config');
        updateTriggersSummary();
        if (!type || !TRIGGER_DEFS[type]) {
            cfg.innerHTML = '<p class="text-sm text-gray-400 italic">Select a trigger type.</p>';
            return;
        }
        cfg.innerHTML = buildTriggerConfigHtml(type, null);
        var targetSel = cfg.querySelector('.trig-target');
        if (targetSel) fillTriggerTarget(targetSel, type, '');
        var days = cfg.querySelector('.trig-days');
        if (days) renderDayCheckboxesInto(days, 'monday,tuesday,wednesday,thursday,friday', 'amber');
    };

    window._removeTrigger = function(id) {
        var list = document.getElementById('triggers-list');
        if (!list) return;
        if (list.querySelectorAll('.trigger-row-card').length <= 1) return;
        var row = document.getElementById(id);
        if (row) row.remove();
        updateTriggerEmpty();
    };

    function updateTriggerEmpty() {
        var list = document.getElementById('triggers-list');
        var empty = document.getElementById('no-triggers');
        if (list && empty) empty.style.display = list.children.length ? 'none' : '';
        updateTriggersSummary();
        updateRuleSummary();
    }

    function updateTriggersSummary() {
        var el = document.getElementById('triggers-summary');
        if (!el) return;
        var list = document.getElementById('triggers-list');
        if (!list) { el.textContent = 'No triggers'; return; }
        var rows = list.querySelectorAll('.trigger-row-card');
        if (!rows.length) { el.textContent = 'No triggers'; return; }
        var labels = [];
        rows.forEach(function(row) {
            var sel = row.querySelector('.trig-type');
            if (!sel || !sel.value) { labels.push('Unset'); return; }
            var def = TRIGGER_DEFS[sel.value];
            labels.push(def ? def.label : sel.value);
        });
        el.textContent = rows.length + (rows.length === 1 ? ' event: ' : ' events: ') + labels.join(', ');
    }

    function countDescendants(el, sel) {
        if (!el) return 0;
        return el.querySelectorAll(sel).length;
    }

    function updateRuleSummary() {
        var el = document.getElementById('rule-summary');
        if (!el) return;
        var list = document.getElementById('triggers-list');
        var tCount = list ? list.querySelectorAll('.trigger-row-card').length : 0;
        var branches = document.getElementById('branches-list');
        var bParts = [];
        var aCount = 0;
        var cCount = 0;
        if (branches) {
            branches.querySelectorAll('.branch-card').forEach(function(card) {
                var kind = card.getAttribute('data-kind') || 'if';
                bParts.push(kind === 'if' ? 'IF' : (kind === 'else_if' ? 'ELSE IF' : 'ELSE'));
                aCount += countDescendants(card.querySelector('.act-list'), ':scope > .action-item');
                cCount += countDescendants(card.querySelector('.cond-list'), ':scope > .condition-item, :scope > .condition-group');
            });
        }
        var tTxt = tCount + ' trigger' + (tCount === 1 ? '' : 's');
        var bTxt = bParts.length ? bParts.join(' / ') : 'no branches';
        var aTxt = aCount + ' action' + (aCount === 1 ? '' : 's');
        var cTxt = cCount ? ' · ' + cCount + ' condition' + (cCount === 1 ? '' : 's') : '';
        el.textContent = tTxt + ' · ' + bTxt + cTxt + ' · ' + aTxt;
    }

    window._toggleSection = function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle('open');
    };

    function updateBranchHeaderSummary(card) {
        if (!card) return;
        var sum = card.querySelector('.branch-summary');
        if (!sum) return;
        var aRoot = card.querySelector('.act-list');
        var aN = aRoot ? aRoot.children.length : 0;
        sum.textContent = aN + ' action' + (aN === 1 ? '' : 's');
    }

    window._toggleBranch = function(id) {
        var card = document.getElementById(id);
        if (!card) return;
        var wasOpen = card.classList.contains('open');
        var list = document.getElementById('branches-list');
        if (list) list.querySelectorAll('.branch-card').forEach(function(c) { c.classList.remove('open'); });
        if (!wasOpen) card.classList.add('open');
        updateBranchHeaderSummary(card);
    };

    function dragHandleHtml() {
        return '<span class="drag-handle" title="Drag to reorder" ' +
            'onclick="event.stopPropagation()">' +
            '<i class="fas fa-grip-vertical"></i></span>';
    }

    function markSortable(el) {
        if (el) el.setAttribute('data-sortable-item', '1');
        return el;
    }

    function clearDropIndicators() {
        document.querySelectorAll('.drop-before, .drop-after').forEach(function(el) {
            el.classList.remove('drop-before', 'drop-after');
        });
    }

    function normalizeBranchOrder(list) {
        if (!list) return;
        var elseCard = list.querySelector('[data-kind="else"]');
        if (elseCard && list.lastElementChild !== elseCard) {
            list.appendChild(elseCard);
        }
    }

    function setModalDefaults() {
        var trigSec = document.getElementById('triggers-section');
        if (trigSec) trigSec.classList.add('open');
        var list = document.getElementById('branches-list');
        if (list) {
            list.querySelectorAll('.branch-card').forEach(function(c) {
                c.classList.remove('open');
            });
        }
    }

    function resolveBranchDrop(list, dragging, sibling, before) {
        var elseCard = list.querySelector('[data-kind="else"]');
        if (!elseCard) return before;
        var isElse = dragging.getAttribute('data-kind') === 'else';
        if (isElse) return before;
        if (sibling === elseCard && !before) return true;
        if (!before && sibling.nextElementSibling === elseCard) return true;
        return before;
    }

    // Pointer-based reorder with cross-list drops (conditions ↔ groups)
    var _sort = null;

    function itemKind(el) {
        if (!el || !el.classList) return null;
        if (el.classList.contains('trigger-row-card')) return 'trigger';
        if (el.classList.contains('branch-card')) return 'branch';
        if (el.classList.contains('action-item')) return 'action';
        if (el.classList.contains('condition-item') || el.classList.contains('condition-group')) return 'condition';
        return null;
    }

    function listKind(list) {
        if (!list || !list.classList) return null;
        if (list.id === 'triggers-list') return 'trigger';
        if (list.id === 'branches-list') return 'branch';
        if (list.classList.contains('act-list')) return 'action';
        if (list.classList.contains('cond-list') || list.classList.contains('group-body')) return 'condition';
        return null;
    }

    function canDropInto(item, list) {
        if (!item || !list || !list.hasAttribute('data-sortable-list')) return false;
        if (list === item || item.contains(list)) return false;
        if (listKind(list) !== itemKind(item)) return false;
        var group = list.classList.contains('group-body') ? list.parentElement : null;
        if (group && group.classList.contains('condition-group')) {
            var modeEl = group.querySelector('.grp-mode');
            if (modeEl && modeEl.value === 'not') {
                var kids = list.children;
                var others = 0;
                for (var i = 0; i < kids.length; i++) {
                    if (kids[i] === item) continue;
                    if (kids[i].hasAttribute && kids[i].hasAttribute('data-sortable-item')) others++;
                }
                if (others >= 1) return false;
            }
        }
        return true;
    }

    function sortableSiblings(list, exclude) {
        var out = [];
        if (!list) return out;
        for (var i = 0; i < list.children.length; i++) {
            var c = list.children[i];
            if (c !== exclude && c.hasAttribute && c.hasAttribute('data-sortable-item')) out.push(c);
        }
        return out;
    }

    function findDropList(clientX, clientY) {
        var el = document.elementFromPoint(clientX, clientY);
        if (!el || !el.closest) return null;
        var item = _sort.item;

        // Hovering a condition group header/body → open it and target its body
        if (itemKind(item) === 'condition') {
            var group = el.closest('.condition-group');
            if (group && item !== group && !item.contains(group)) {
                var overHeader = el.closest('.group-header') || el.closest('.group-actions');
                var overOwnBody = group.classList.contains('open') && group.querySelector('.group-body') &&
                    group.querySelector('.group-body').contains(el);
                if (overHeader || !overOwnBody) {
                    group.classList.add('open');
                    var body = group.querySelector('.group-body');
                    if (body && canDropInto(item, body)) return body;
                }
            }
        }

        var list = el.closest('[data-sortable-list]');
        if (list && canDropInto(item, list)) return list;

        // Empty padding of cond-root → its cond-list
        var root = el.closest('.cond-root');
        if (root) {
            var rl = root.querySelector('.cond-list');
            if (rl && canDropInto(item, rl)) return rl;
        }
        return null;
    }

    function updateSortIndicator(clientX, clientY) {
        if (!_sort || !_sort.active) return;
        clearDropIndicators();
        document.querySelectorAll('.drop-into').forEach(function(el) {
            el.classList.remove('drop-into');
        });

        var list = findDropList(clientX, clientY);
        if (!list) {
            _sort.targetList = null;
            _sort.target = null;
            _sort.before = false;
            return;
        }

        _sort.targetList = list;
        var siblings = sortableSiblings(list, _sort.item);

        if (!siblings.length) {
            list.classList.add('drop-into');
            _sort.target = null;
            _sort.before = false;
            return;
        }

        var target = null;
        var before = false;
        for (var i = 0; i < siblings.length; i++) {
            var r = siblings[i].getBoundingClientRect();
            if (clientY < r.top + r.height * 0.5) {
                target = siblings[i];
                before = true;
                break;
            }
        }
        if (!target) {
            target = siblings[siblings.length - 1];
            before = false;
        }

        if (list.id === 'branches-list') {
            before = resolveBranchDrop(list, _sort.item, target, before);
        }

        if (target) target.classList.add(before ? 'drop-before' : 'drop-after');
        _sort.target = target;
        _sort.before = before;
    }

    function afterConditionMove(item) {
        var branch = item.closest ? item.closest('.branch-card') : null;
        if (!branch) return;
        if (branch.querySelector('.root-mode')) refreshRootMode(branch);
        updateBranchHeaderSummary(branch);
    }

    function commitSort() {
        if (!_sort || !_sort.active) return;
        var item = _sort.item;
        var list = _sort.targetList;
        var target = _sort.target;
        var oldParent = _sort.list;

        if (list && canDropInto(item, list)) {
            if (target && target.parentElement === list) {
                if (_sort.before) list.insertBefore(item, target);
                else list.insertBefore(item, target.nextSibling);
            } else {
                list.appendChild(item);
            }
        }

        if (oldParent && oldParent !== item.parentElement) {
            var oldGroup = oldParent.classList.contains('group-body') ? oldParent.parentElement : null;
            if (oldGroup) {
                oldGroup.classList.add('open');
                refreshGroupCount(oldGroup);
            }
            var oldRoot = oldParent.classList.contains('cond-list') ? oldParent.closest('.branch-card') : null;
            if (oldRoot) refreshRootMode(oldRoot);
        }

        if (item.parentElement && item.parentElement.id === 'branches-list') {
            normalizeBranchOrder(item.parentElement);
            updateBranchControls();
        }

        var newGroup = item.parentElement && item.parentElement.classList.contains('group-body')
            ? item.parentElement.parentElement : null;
        if (newGroup) {
            newGroup.classList.add('open');
            refreshGroupCount(newGroup);
        }

        if (item.classList.contains('branch-card')) {
            updateBranchHeaderSummary(item);
        } else if (item.classList.contains('condition-group')) {
            refreshGroupCount(item);
        }

        if (itemKind(item) === 'condition') afterConditionMove(item);
        updateRuleSummary();
    }

    function clearSortVisuals() {
        clearDropIndicators();
        document.querySelectorAll('.drop-into').forEach(function(el) {
            el.classList.remove('drop-into');
        });
    }

    function endSort() {
        if (!_sort) return;
        if (_sort.active) {
            commitSort();
            if (_sort.item) _sort.item.classList.remove('dragging');
        }
        clearSortVisuals();
        document.body.classList.remove('is-sorting');
        _sort = null;
    }

    document.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        if (!e.target || !e.target.closest) return;
        var handle = e.target.closest('.drag-handle');
        if (!handle) return;
        var item = handle.closest('[data-sortable-item]');
        if (!item || !item.parentElement || !item.parentElement.hasAttribute('data-sortable-list')) return;
        e.preventDefault();
        _sort = {
            item: item,
            list: item.parentElement,
            targetList: item.parentElement,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            target: null,
            before: false
        };
    }, true);

    document.addEventListener('mousemove', function(e) {
        if (!_sort) return;
        if (!_sort.active) {
            if (Math.abs(e.clientX - _sort.startX) < 4 && Math.abs(e.clientY - _sort.startY) < 4) return;
            _sort.active = true;
            _sort.item.classList.add('dragging');
            document.body.classList.add('is-sorting');
        }
        updateSortIndicator(e.clientX, e.clientY);
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('mouseup', function() {
        endSort();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && _sort) {
            if (_sort.active && _sort.item) _sort.item.classList.remove('dragging');
            clearSortVisuals();
            document.body.classList.remove('is-sorting');
            _sort = null;
        }
    });

    function addTriggerRow(data) {
        var list = document.getElementById('triggers-list');
        var id = 'trig-' + (++_trigCounter);
        var row = document.createElement('div');
        row.className = 'trigger-row-card';
        row.id = id;
        markSortable(row);
        var type = (data && data.type) || '';
        var html = '<div class="flex items-start gap-2">' +
            dragHandleHtml() +
            '<div class="flex-1">' +
            '<div class="flex gap-2 items-center mb-2 flex-wrap">' +
            buildTriggerTypeSelect(id, type) +
            '</div>' +
            '<div class="trig-config"></div>' +
            '</div>' +
            '<button onclick="window._removeTrigger(\'' + id + '\')" class="mt-1 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove trigger"><i class="fas fa-times"></i></button>' +
            '</div>';
        row.innerHTML = html;
        list.appendChild(row);

        var cfg = row.querySelector('.trig-config');
        if (type && TRIGGER_DEFS[type]) {
            cfg.innerHTML = buildTriggerConfigHtml(type, data);
            var targetSel = cfg.querySelector('.trig-target');
            if (targetSel) fillTriggerTarget(targetSel, type, data && data.target_id);
            var days = cfg.querySelector('.trig-days');
            if (days) {
                var dayVal = '';
                if (data) dayVal = (data.config && data.config.trigger_days) || data.trigger_days || '';
                if (!dayVal) dayVal = 'monday,tuesday,wednesday,thursday,friday';
                renderDayCheckboxesInto(days, dayVal, 'amber');
            }
        } else {
            cfg.innerHTML = '<p class="text-sm text-gray-400 italic">Select a trigger type.</p>';
        }
        updateTriggerEmpty();
        return row;
    }

    window.addTrigger = function() {
        addTriggerRow(null);
        var sec = document.getElementById('triggers-section');
        if (sec) sec.classList.add('open');
    };

    function collectTriggerRow(row) {
        var type = row.querySelector('.trig-type').value;
        var result = { type: type };
        if (!type) return result;
        var def = TRIGGER_DEFS[type];
        var cfgEl = row.querySelector('.trig-config');
        if (def.showTarget) {
            var t = cfgEl.querySelector('.trig-target');
            result.target_id = t ? t.value : '';
        }
        if (type === 'light_state_change' || type === 'room_state_change') {
            var cbs = cfgEl.querySelectorAll('.trigger-prop-cb');
            var props = [];
            cbs.forEach(function(cb) { if (cb.checked) props.push(cb.value); });
            result.triggerProperties = props;
            result.config = result.config || {};
            var hasOn = props.indexOf('on') >= 0;
            var hasOff = props.indexOf('off') >= 0;
            if (hasOn && !hasOff) result.config.wanted_state = 'on';
            else if (hasOff && !hasOn) result.config.wanted_state = 'off';
            result.attributes = props.slice();
        }
        if (def.extraFields) {
            result.config = result.config || {};
            def.extraFields.forEach(function(f) {
                if (f.type === 'select' || f.type === 'time') {
                    var el = cfgEl.querySelector('.trig-extra-' + f.key);
                    if (el) result.config[f.key] = el.value;
                } else if (f.type === 'day_checkboxes') {
                    var dcb = cfgEl.querySelectorAll('.trig-days .day-cb');
                    var days = [];
                    dcb.forEach(function(cb) { if (cb.checked) days.push(cb.value); });
                    result.config.trigger_days = days.join(',');
                }
            });
        }
        return result;
    }

    function collectTriggers() {
        var list = document.getElementById('triggers-list');
        var out = [];
        list.querySelectorAll('.trigger-row-card').forEach(function(row) {
            var t = collectTriggerRow(row);
            if (t.type) out.push(t);
        });
        return out;
    }

    // ===== CONDITIONS (tree) =====

    function mapConditionToUI(cond) {
        var result = { _category: '', _property: '', _propValue: '', target_id: cond.target_id || '' };
        var t = cond.type || '';
        if (t === 'light_is_on' || t === 'light_is_off') {
            result._category = 'light';
            result._property = 'state';
            result._propValue = t === 'light_is_on' ? 'on' : 'off';
        } else if (t === 'room_is_on' || t === 'room_is_off') {
            result._category = cond.target_type || 'room';
            result._property = 'state';
            result._propValue = t === 'room_is_on' ? 'on' : 'off';
        } else if (t === 'door_is_open' || t === 'door_is_closed') {
            result._category = 'door';
            result._property = 'state';
            result._propValue = t === 'door_is_open' ? 'open' : 'closed';
        } else if (t === 'brightness_above' || t === 'brightness_below') {
            result._category = cond.target_type || 'light';
            result._property = 'brightness';
            result._propValue = (cond.operator || '>') + '|' + (cond.value !== undefined && cond.value !== null ? cond.value : 50);
        } else if (t === 'time_range') {
            result._category = 'time';
            result._property = 'range';
            result._propValue = (cond.start || '07:00') + '|' + (cond.end || '23:00');
        } else if (t === 'day_of_week') {
            result._category = 'day';
            result._property = 'days';
            result._propValue = cond.value || '';
        } else if (t === 'scene_active') {
            result._category = cond.target_type || 'room';
            result._property = 'scene';
            result._propValue = cond.scene_id || '';
        } else if (t) {
            result._category = cond.target_type || '';
        }
        return result;
    }

    function buildCondEntitySelect(id, cat, selectedValue) {
        var catDef = COND_CATEGORIES[cat];
        if (!catDef || !catDef.targetCategory) return '';
        var items = targets[catDef.targetCategory] || [];
        var key = (catDef.targetCategory === 'motion_sensors' || catDef.targetCategory === 'door_sensors') ? 'mac' : 'id';
        var html = '<select class="cond-target border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondEntityChange(\'' + id + '\')">';
        html += '<option value="">Select ' + esc(catDef.label.toLowerCase()) + '...</option>';
        items.forEach(function(item) {
            var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
            html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
        });
        html += '</select>';
        return html;
    }

    function addConditionLeaf(container, data) {
        var id = 'cond-' + (++_condCounter);
        var row = document.createElement('div');
        row.className = 'condition-item bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2';
        row.id = id;
        markSortable(row);
        var restored = data ? mapConditionToUI(data) : null;
        var catOptions = '<option value="">Select category...</option>';
        Object.keys(COND_CATEGORIES).forEach(function(k) {
            var c = COND_CATEGORIES[k];
            var sel = (restored && restored._category === k) ? ' selected' : '';
            catOptions += '<option value="' + k + '"' + sel + '>' + esc(c.label) + '</option>';
        });
        var html =
            '<div class="flex gap-2 items-center">' +
            dragHandleHtml() +
            '<div class="flex gap-2 items-center flex-wrap flex-1">' +
            '<select class="cond-cat border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondCatChange(\'' + id + '\')">' +
            catOptions + '</select>' +
            '<div class="cond-entity-wrap"></div>' +
            '<span class="text-gray-400 text-sm">where</span>' +
            '<div class="cond-props-wrap flex-1"></div>' +
            '</div>' +
            '<button onclick="window._removeConditionNode(\'' + id + '\')" class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove condition"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="pl-7 mt-2">' +
            '<div class="cond-detail-wrap"></div>' +
            '</div>';
        row.innerHTML = html;
        container.appendChild(row);
        if (restored && restored._category) {
            window._populateCondProps(id, restored._category, data);
        }
        var parentGroup = container.closest ? container.closest('.condition-group') : null;
        if (parentGroup) {
            parentGroup.classList.add('open');
            refreshGroupCount(parentGroup);
        }
        var rootCard = container.closest ? container.closest('.branch-card') : null;
        if (rootCard && rootCard.querySelector('.root-mode')) refreshRootMode(rootCard);
        updateBranchHeaderSummary(row.closest('.branch-card'));
        updateRuleSummary();
        return row;
    }

    function addConditionGroup(container, data) {
        var id = 'grp-' + (++_condCounter);
        var mode = (data && data.type) || 'and';
        if (mode !== 'and' && mode !== 'or' && mode !== 'not') mode = 'and';
        var wrap = document.createElement('div');
        wrap.className = 'condition-group open';
        wrap.id = id;
        wrap.setAttribute('data-group', '1');
        markSortable(wrap);
        var modeOptions =
            '<option value="and"' + (mode === 'and' ? ' selected' : '') + '>ALL</option>' +
            '<option value="or"' + (mode === 'or' ? ' selected' : '') + '>ANY</option>' +
            '<option value="not"' + (mode === 'not' ? ' selected' : '') + '>NOT</option>';
        wrap.innerHTML =
            '<div class="group-header" onclick="window._toggleGroup(\'' + id + '\')">' +
            dragHandleHtml() +
            '<i class="fas fa-chevron-down chevron text-xs"></i>' +
            '<select class="grp-mode border border-gray-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onclick="event.stopPropagation()" onchange="window._onGroupModeChange(\'' + id + '\')">' +
            modeOptions + '</select>' +
            '<span class="text-xs text-indigo-700 font-medium grp-hint flex-1 truncate"></span>' +
            '<button onclick="event.stopPropagation(); window._removeConditionNode(\'' + id + '\')" class="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove group"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="group-body space-y-2" data-sortable-list="1"></div>' +
            '<div class="mt-2 flex gap-2 px-2 pb-2 group-actions">' +
            '<button onclick="window._addGroupChild(\'' + id + '\', \'leaf\')" class="btn-add-in-group px-2.5 py-1 bg-indigo-500 text-white text-xs font-medium rounded-md hover:bg-indigo-600 transition-colors"><i class="fas fa-plus mr-1"></i>Add condition</button>' +
            '<button onclick="window._addGroupChild(\'' + id + '\', \'group\')" class="btn-add-in-group px-2.5 py-1 bg-indigo-400 text-white text-xs font-medium rounded-md hover:bg-indigo-500 transition-colors"><i class="fas fa-layer-group mr-1"></i>Add group</button>' +
            '</div>';
        container.appendChild(wrap);
        var body = wrap.querySelector('.group-body');
        var children = (data && data.conditions) || [];
        children.forEach(function(c) {
            if (c && (c.type === 'and' || c.type === 'or' || c.type === 'not')) addConditionGroup(body, c);
            else addConditionLeaf(body, c);
        });
        updateGroupModeUI(wrap);
        refreshGroupCount(wrap);
        var parentGroup = container.closest ? container.closest('.condition-group') : null;
        if (parentGroup) refreshGroupCount(parentGroup);
        if (children.length) {
            wrap.classList.remove('open');
        }
        var rootCard = wrap.closest ? wrap.closest('.branch-card') : null;
        if (rootCard && rootCard.querySelector('.root-mode')) refreshRootMode(rootCard);
        updateBranchHeaderSummary(wrap.closest ? wrap.closest('.branch-card') : null);
        updateRuleSummary();
        return wrap;
    }

    window._toggleGroup = function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle('open');
    };

    function refreshGroupCount(groupEl) {
        if (!groupEl) return;
        updateBranchHeaderSummary(groupEl.closest('.branch-card'));
        updateRuleSummary();
    }

    function groupDepth(el) {
        var d = 0;
        var p = el.parentElement;
        while (p) {
            if (p.classList && p.classList.contains('condition-group')) d++;
            p = p.parentElement;
        }
        return d;
    }

    function updateGroupModeUI(groupEl) {
        var mode = groupEl.querySelector('.grp-mode').value;
        var hint = groupEl.querySelector('.grp-hint');
        var body = groupEl.querySelector('.group-body');
        var btns = groupEl.querySelectorAll('.btn-add-in-group');
        var labels = { and: 'all nested must match', or: 'any nested may match', not: 'invert single nested' };
        if (hint) hint.textContent = labels[mode] || '';
        var isNot = mode === 'not';
        btns.forEach(function(b) { b.style.display = isNot ? 'none' : ''; });
        if (isNot) {
            var kids = body.querySelectorAll(':scope > .condition-item, :scope > .condition-group');
            if (kids.length > 1) {
                for (var i = 1; i < kids.length; i++) kids[i].remove();
            }
        }
        var depth = groupDepth(groupEl);
        groupEl.querySelectorAll('.btn-add-in-group').forEach(function(b) {
            if (b.textContent.indexOf('group') >= 0) {
                if (depth >= MAX_COND_DEPTH - 1) b.style.display = 'none';
                else if (mode !== 'not') b.style.display = '';
            }
        });
        refreshGroupCount(groupEl);
    }

    window._onGroupModeChange = function(id) {
        var el = document.getElementById(id);
        if (el) updateGroupModeUI(el);
    };

    window._addGroupChild = function(groupId, kind) {
        var g = document.getElementById(groupId);
        if (!g) return;
        g.classList.add('open');
        if (g.querySelector('.grp-mode').value === 'not') return;
        var body = g.querySelector('.group-body');
        if (kind === 'group') {
            if (groupDepth(g) >= MAX_COND_DEPTH - 1) {
                showToast('Depth', 'Maximum group nesting reached.', 'warning');
                return;
            }
            addConditionGroup(body, null);
        } else {
            addConditionLeaf(body, null);
        }
        updateGroupModeUI(g);
    };

    window._removeConditionNode = function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var parent = el.parentElement;
        var parentGroup = parent && parent.classList && parent.classList.contains('group-body') ? parent.parentElement : null;
        el.remove();
        if (parentGroup) refreshGroupCount(parentGroup);
        if (parentGroup) parentGroup.classList.add('open');
        var branch = parentGroup ? parentGroup.closest('.branch-card') : el.closest('.branch-card');
        if (!branch) branch = document.querySelector('#branches-list .branch-card.open');
        if (branch && branch.querySelector('.root-mode')) refreshRootMode(branch);
        updateBranchHeaderSummary(branch || null);
        updateRuleSummary();
    };

    window._onCondCatChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var cat = row.querySelector('.cond-cat').value;
        row.querySelector('.cond-entity-wrap').innerHTML = '';
        row.querySelector('.cond-props-wrap').innerHTML = '';
        row.querySelector('.cond-detail-wrap').innerHTML = '';
        if (!cat) return;
        window._populateCondProps(id, cat, null);
    };

    window._onCondEntityChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var sceneSel = row.querySelector('.cond-scene');
        if (sceneSel) {
            var targetSel = row.querySelector('.cond-target');
            var groupId = targetSel ? targetSel.value : '';
            var prev = sceneSel.value;
            populateSceneSelect(sceneSel, prev, groupId);
        }
    };

    window._populateCondProps = function(id, cat, data) {
        var row = document.getElementById(id);
        if (!row) return;
        var entityWrap = row.querySelector('.cond-entity-wrap');
        var wrap = row.querySelector('.cond-props-wrap');
        var detailWrap = row.querySelector('.cond-detail-wrap');
        var catDef = COND_CATEGORIES[cat];
        var restored = data ? mapConditionToUI(data) : null;
        var restoredTargetId = restored ? restored.target_id : '';
        if (catDef && catDef.targetCategory) {
            entityWrap.innerHTML = buildCondEntitySelect(id, cat, restoredTargetId);
        } else {
            entityWrap.innerHTML = '';
        }
        if (!catDef) { wrap.innerHTML = ''; entityWrap.innerHTML = ''; return; }
        if (catDef.skipProperty) {
            wrap.innerHTML = '';
            var props = COND_PROPERTIES[cat];
            var firstKey = Object.keys(props)[0];
            if (firstKey) window._renderCondPropDetail(id, cat, firstKey, data);
            return;
        }
        var props2 = COND_PROPERTIES[cat];
        if (!props2) return;
        var restoredProp = restored ? (restored._property || '') : '';
        var html = '<select class="cond-prop border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondPropChange(\'' + id + '\')">';
        html += '<option value="">Select property...</option>';
        Object.keys(props2).forEach(function(k) {
            var sel = (restoredProp === k) ? ' selected' : '';
            html += '<option value="' + k + '"' + sel + '>' + esc(props2[k].label) + '</option>';
        });
        html += '</select>';
        wrap.innerHTML = html;
        if (restoredProp && props2[restoredProp]) {
            window._renderCondPropDetail(id, cat, restoredProp, data);
        }
    };

    window._renderCondPropDetail = function(id, cat, prop, data) {
        var row = document.getElementById(id);
        if (!row) return;
        var detailWrap = row.querySelector('.cond-detail-wrap');
        var propDef = COND_PROPERTIES[cat] && COND_PROPERTIES[cat][prop];
        if (!propDef) { detailWrap.innerHTML = ''; return; }
        var restored = data ? mapConditionToUI(data) : null;
        var restoredPropValue = restored ? (restored._propValue || '') : '';
        var html = '';
        if (propDef.type === 'select') {
            html += '<select class="cond-value border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">';
            propDef.options.forEach(function(o) {
                var sel = (restoredPropValue === o.value) ? ' selected' : '';
                html += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
            });
            html += '</select>';
        } else if (propDef.type === 'compare') {
            var parts = restoredPropValue.split('|');
            var op = parts[0] || '>=';
            var val = parts[1] || '50';
            html += '<div class="flex items-center gap-2">' +
                '<select class="cond-comp-op border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">' +
                '<option value=">="' + (op === '>=' ? ' selected' : '') + '>&ge;</option>' +
                '<option value="<="' + (op === '<=' ? ' selected' : '') + '>&le;</option>' +
                '<option value=">"' + (op === '>' ? ' selected' : '') + '>&gt;</option>' +
                '<option value="<"' + (op === '<' ? ' selected' : '') + '>&lt;</option>' +
                '<option value="=="' + (op === '==' ? ' selected' : '') + '>= (equals)</option>' +
                '</select>' +
                '<input type="number" class="cond-comp-val border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" min="0" max="100" value="' + esc(val) + '">' +
                '<span class="text-sm text-gray-500">%</span></div>';
        } else if (propDef.type === 'time_range') {
            var tparts = restoredPropValue.split('|');
            var start = tparts[0] || '07:00';
            var end = tparts[1] || '23:00';
            html += '<div class="flex items-center gap-2">' +
                '<input type="time" class="cond-time-start border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" value="' + esc(start) + '">' +
                '<span class="text-sm text-gray-500">to</span>' +
                '<input type="time" class="cond-time-end border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" value="' + esc(end) + '">' +
                '</div>';
        } else if (propDef.type === 'day_checkboxes') {
            html += '<div class="cond-days mt-1"></div>';
        } else if (propDef.type === 'scene_select') {
            html += '<select class="cond-scene border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></select>';
        }
        detailWrap.innerHTML = html;
        if (propDef.type === 'day_checkboxes') {
            renderDayCheckboxesInto(detailWrap.querySelector('.cond-days'), restoredPropValue || 'monday,tuesday,wednesday,thursday,friday', 'indigo');
        }
        if (propDef.type === 'scene_select') {
            var sel = detailWrap.querySelector('.cond-scene');
            if (sel) {
                var targetSel = row.querySelector('.cond-target');
                var groupId = targetSel ? targetSel.value : '';
                populateSceneSelect(sel, restoredPropValue, groupId);
            }
        }
    };

    window._onCondPropChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var cat = row.querySelector('.cond-cat').value;
        var prop = row.querySelector('.cond-prop').value;
        window._renderCondPropDetail(id, cat, prop, null);
    };

    function collectConditionData(el, cat, prop) {
        var cond = {};
        var targetSel = el.querySelector('.cond-target');
        if (targetSel) cond.target_id = targetSel.value;
        cond.target_type = cat;
        if (cat === 'light' || cat === 'room' || cat === 'zone') {
            var valEl = el.querySelector('.cond-value');
            var val = valEl ? valEl.value : '';
            if (prop === 'state') {
                if (cat === 'light') cond.type = val === 'on' ? 'light_is_on' : 'light_is_off';
                else cond.type = val === 'on' ? 'room_is_on' : 'room_is_off';
            } else if (prop === 'brightness') {
                var opEl = el.querySelector('.cond-comp-op');
                var numEl = el.querySelector('.cond-comp-val');
                var op = opEl ? opEl.value : '>=';
                var num = numEl ? parseInt(numEl.value, 10) : 50;
                cond.type = op === '<' || op === '<=' ? 'brightness_below' : 'brightness_above';
                cond.operator = op;
                cond.value = num;
            } else if (prop === 'scene') {
                var sceneEl = el.querySelector('.cond-scene');
                cond.type = 'scene_active';
                cond.scene_id = sceneEl ? sceneEl.value : '';
            }
        } else if (cat === 'door') {
            var dval = el.querySelector('.cond-value');
            var dv = dval ? dval.value : 'open';
            cond.type = dv === 'open' ? 'door_is_open' : 'door_is_closed';
        } else if (cat === 'time') {
            var startEl = el.querySelector('.cond-time-start');
            var endEl = el.querySelector('.cond-time-end');
            cond.type = 'time_range';
            cond.start = startEl ? startEl.value : '07:00';
            cond.end = endEl ? endEl.value : '23:00';
        } else if (cat === 'day') {
            var cbs = el.querySelectorAll('.day-cb');
            var days = [];
            cbs.forEach(function(cb) { if (cb.checked) days.push(cb.value); });
            cond.type = 'day_of_week';
            cond.value = days.join(',');
        }
        return cond;
    }

    function collectConditionTree(container) {
        var out = [];
        if (!container) return out;
        Array.prototype.forEach.call(container.children, function(child) {
            if (child.classList.contains('condition-group')) {
                var mode = child.querySelector('.grp-mode').value;
                var kids = collectConditionTree(child.querySelector('.group-body'));
                if (mode === 'not') {
                    if (kids.length) out.push({ type: 'not', conditions: [kids[0]] });
                } else if (kids.length) {
                    out.push({ type: mode, conditions: kids });
                }
            } else if (child.classList.contains('condition-item')) {
                var catEl = child.querySelector('.cond-cat');
                var cat = catEl ? catEl.value : '';
                var propEl = child.querySelector('.cond-prop');
                var prop = propEl ? propEl.value : '';
                if (cat) {
                    var c = collectConditionData(child, cat, prop);
                    if (c.type) out.push(c);
                }
            }
        });
        return out;
    }

    function renderConditionTree(container, conditions) {
        (conditions || []).forEach(function(c) {
            if (c && (c.type === 'and' || c.type === 'or' || c.type === 'not')) {
                addConditionGroup(container, c);
            } else if (c && c.type) {
                addConditionLeaf(container, c);
            }
        });
    }

    // ===== ACTIONS =====

    function mapActionToUI(action) {
        var result = { _category: '', _entity: '', _action: '' };
        var t = action.type || '';
        if (t === 'turn_on_room') {
            result._category = action.group_type === 'zone' ? 'zone' : 'room';
            result._action = 'turn_on';
            result._entity = action.group_id || '';
        } else if (t === 'turn_off_room') {
            result._category = action.group_type === 'zone' ? 'zone' : 'room';
            result._action = 'turn_off';
            result._entity = action.group_id || '';
        } else if (t === 'set_light_on') {
            result._category = 'light';
            result._action = 'turn_on';
            result._entity = action.target_id || '';
        } else if (t === 'set_light_off') {
            result._category = 'light';
            result._action = 'turn_off';
            result._entity = action.target_id || '';
        } else if (t === 'set_light_brightness') {
            if (action.group_id) {
                result._category = action.group_type === 'zone' ? 'zone' : 'room';
                result._entity = action.group_id;
            } else {
                result._category = 'light';
                result._entity = action.target_id || '';
            }
            result._action = 'brightness';
        } else if (t === 'set_light_color') {
            result._category = 'light';
            result._action = 'color_temp';
            result._entity = action.target_id || '';
        } else if (t === 'call_scene') {
            result._category = action.group_type === 'zone' ? 'zone' : 'room';
            result._action = 'scene';
            result._entity = action.group_id || '';
        } else if (t === 'delay') {
            result._category = 'delay';
            result._action = 'delay';
        } else if (t === 'log_message') {
            result._category = 'log';
            result._action = 'log';
        }
        return result;
    }

    function addActionRow(container, data) {
        var id = 'act-' + (++_actCounter);
        var row = document.createElement('div');
        row.className = 'action-item bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2';
        row.id = id;
        markSortable(row);
        var restored = data ? mapActionToUI(data) : null;
        var catOptions = '<option value="">Select category...</option>';
        Object.keys(ACTION_CATEGORIES).forEach(function(k) {
            var c = ACTION_CATEGORIES[k];
            var sel = (restored && restored._category === k) ? ' selected' : '';
            catOptions += '<option value="' + k + '"' + sel + '>' + esc(c.label) + '</option>';
        });
        var html =
            '<div class="flex gap-2 items-center">' +
            dragHandleHtml() +
            '<div class="flex gap-2 items-center flex-wrap flex-1">' +
            '<select class="act-cat border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActCatChange(\'' + id + '\')">' +
            catOptions + '</select>' +
            '<div class="act-entity-wrap"></div>' +
            '<div class="act-type-wrap"></div>' +
            '</div>' +
            '<button onclick="window._removeAction(\'' + id + '\')" class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove action"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="pl-7 mt-2">' +
            '<div class="act-extra-wrap"></div>' +
            '</div>';
        row.innerHTML = html;
        container.appendChild(row);
        updateBranchHeaderSummary(row.closest ? row.closest('.branch-card') : null);
        updateRuleSummary();
        if (restored) window._onActCatChange(id, data);
        return row;
    }

    window._onActCatChange = function(id, data) {
        var row = document.getElementById(id);
        if (!row) return;
        var cat = row.querySelector('.act-cat').value;
        var entityWrap = row.querySelector('.act-entity-wrap');
        var typeWrap = row.querySelector('.act-type-wrap');
        var extraWrap = row.querySelector('.act-extra-wrap');
        entityWrap.innerHTML = '';
        typeWrap.innerHTML = '';
        extraWrap.innerHTML = '';
        if (!cat) return;
        var catDef = ACTION_CATEGORIES[cat];
        var restored = data ? mapActionToUI(data) : null;
        if (cat === 'delay') {
            var val = data && data.seconds ? data.seconds : '';
            typeWrap.innerHTML = '<input type="number" class="act-delay-seconds border border-gray-300 rounded-lg px-3 py-2 text-sm w-28 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="Seconds" min="0.1" max="3600" step="0.1" value="' + esc(val) + '">';
            return;
        }
        if (cat === 'log') {
            var lval = data && data.message ? data.message : '';
            typeWrap.innerHTML = '<input type="text" class="act-log-message border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="Log message..." value="' + esc(lval) + '">';
            return;
        }
        if (catDef.targetCategory) {
            var items = targets[catDef.targetCategory] || [];
            var key = (catDef.targetCategory === 'motion_sensors' || catDef.targetCategory === 'door_sensors') ? 'mac' : 'id';
            var html = '<select class="act-entity border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActTypeChange(\'' + id + '\')">';
            html += '<option value="">Select ' + esc(catDef.label.toLowerCase()) + '...</option>';
            items.forEach(function(item) {
                var sel = (restored && String(restored._entity) === String(item[key])) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
            html += '</select>';
            entityWrap.innerHTML = html;
        }
        var actionTypes = ACTION_TYPES[cat];
        if (actionTypes) {
            var thtml = '<select class="act-type border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActTypeChange(\'' + id + '\')">';
            thtml += '<option value="">Select action...</option>';
            actionTypes.forEach(function(a) {
                var sel = (restored && restored._action === a.value) ? ' selected' : '';
                thtml += '<option value="' + a.value + '"' + sel + '>' + esc(a.label) + '</option>';
            });
            thtml += '</select>';
            typeWrap.innerHTML = thtml;
        }
        if (restored && restored._entity && restored._action) {
            window._onActTypeChange(id, data);
        } else if (restored && (cat === 'delay' || cat === 'log')) {
            // already handled
        }
    };

    window._onActTypeChange = function(id, data) {
        var row = document.getElementById(id);
        if (!row) return;
        var cat = row.querySelector('.act-cat').value;
        var actType = row.querySelector('.act-type');
        var action = actType ? actType.value : '';
        var extraWrap = row.querySelector('.act-extra-wrap');
        extraWrap.innerHTML = '';
        if (!action) return;
        if (cat === 'room' || cat === 'light' || cat === 'zone') {
            if (action === 'brightness') {
                var val = '';
                var force = false;
                if (data && data.type === 'set_light_brightness') {
                    val = data.brightness !== undefined ? data.brightness : '';
                    force = data.force || false;
                }
                extraWrap.innerHTML = '<div class="flex items-center gap-3 mt-2">' +
                    '<label class="text-sm text-gray-600">Brightness:</label>' +
                    '<input type="number" class="act-brightness border border-gray-300 rounded-lg px-3 py-2 text-sm w-20 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" min="0" max="100" value="' + esc(val) + '">' +
                    '<span class="text-sm text-gray-500">%</span>' +
                    '<label class="inline-flex items-center gap-1 text-sm text-gray-600 cursor-pointer">' +
                    '<input type="checkbox" class="act-force rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"' + (force ? ' checked' : '') + '> Force' +
                    '</label></div>';
            } else if (action === 'color_temp') {
                var ctval = '';
                if (data && data.type === 'set_light_color') ctval = data.ct !== undefined ? data.ct : '';
                extraWrap.innerHTML = '<div class="flex items-center gap-3 mt-2">' +
                    '<label class="text-sm text-gray-600">Color Temp:</label>' +
                    '<input type="number" class="act-ct border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" min="153" max="500" value="' + esc(ctval) + '">' +
                    '<span class="text-sm text-gray-500">K</span></div>';
            } else if (action === 'scene') {
                var sval = '';
                if (data && data.type === 'call_scene') sval = data.scene_id || '';
                extraWrap.innerHTML = '<div class="flex items-center gap-3 mt-2">' +
                    '<label class="text-sm text-gray-600">Scene:</label>' +
                    '<select class="act-scene border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"></select></div>';
                var sel = extraWrap.querySelector('.act-scene');
                if (sel) {
                    var entityEl = row.querySelector('.act-entity');
                    var groupId = entityEl ? entityEl.value : '';
                    populateSceneSelect(sel, sval, groupId);
                }
            }
        }
    };

    window._removeAction = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var branch = row.closest ? row.closest('.branch-card') : null;
        row.remove();
        updateBranchHeaderSummary(branch);
        updateRuleSummary();
    };

    function collectActions(container) {
        var out = [];
        if (!container) return out;
        container.querySelectorAll('.action-item').forEach(function(row) {
            var catEl = row.querySelector('.act-cat');
            var cat = catEl ? catEl.value : '';
            if (!cat) return;
            if (cat === 'delay') {
                var secEl = row.querySelector('.act-delay-seconds');
                var secs = secEl ? parseFloat(secEl.value) : 1;
                if (isNaN(secs) || secs < 0.1) secs = 0.1;
                out.push({ type: 'delay', seconds: secs });
                return;
            }
            if (cat === 'log') {
                var msgEl = row.querySelector('.act-log-message');
                out.push({ type: 'log_message', message: msgEl ? msgEl.value : '' });
                return;
            }
            var entityEl = row.querySelector('.act-entity');
            var actTypeEl = row.querySelector('.act-type');
            var entity = entityEl ? entityEl.value : '';
            var action = actTypeEl ? actTypeEl.value : '';
            if (!entity || !action) return;
            var actionTypes = ACTION_TYPES[cat];
            var backendType = '';
            actionTypes.forEach(function(a) { if (a.value === action) backendType = a.backendType; });
            if (!backendType) return;
            var act = { type: backendType };
            if (cat === 'room' || cat === 'zone') {
                act.group_id = entity;
                act.group_type = cat;
                if (backendType === 'set_light_brightness') {
                    var brEl = row.querySelector('.act-brightness');
                    var forceEl = row.querySelector('.act-force');
                    act.brightness = brEl ? parseInt(brEl.value, 10) : 50;
                    act.force = forceEl ? forceEl.checked : false;
                    act.target_id = entity;
                }
                if (backendType === 'call_scene') {
                    var sceneEl = row.querySelector('.act-scene');
                    act.scene_id = sceneEl ? sceneEl.value : '';
                }
            } else if (cat === 'light') {
                act.target_id = entity;
                if (backendType === 'set_light_on') {
                    var brEl2 = row.querySelector('.act-brightness');
                    if (brEl2 && brEl2.value !== '') act.brightness = parseInt(brEl2.value, 10);
                }
                if (backendType === 'set_light_brightness') {
                    var brEl3 = row.querySelector('.act-brightness');
                    var forceEl3 = row.querySelector('.act-force');
                    act.brightness = brEl3 ? parseInt(brEl3.value, 10) : 50;
                    act.force = forceEl3 ? forceEl3.checked : false;
                }
                if (backendType === 'set_light_color') {
                    var ctEl = row.querySelector('.act-ct');
                    act.ct = ctEl ? parseInt(ctEl.value, 10) : 300;
                }
            }
            out.push(act);
        });
        return out;
    }

    // ===== BRANCHES =====

    function branchBadge(kind) {
        if (kind === 'if') return { cls: 'branch-if-badge', label: 'IF' };
        if (kind === 'else_if') return { cls: 'branch-elif-badge', label: 'ELSE IF' };
        return { cls: 'branch-else-badge', label: 'ELSE' };
    }

    function updateBranchControls() {
        var list = document.getElementById('branches-list');
        if (!list) return;
        var hasElse = !!list.querySelector('[data-kind="else"]');
        var addElse = document.getElementById('btn-add-else');
        if (addElse) addElse.style.display = hasElse ? 'none' : '';
        list.querySelectorAll('.branch-card').forEach(function(card) {
            var kind = card.getAttribute('data-kind');
            var rm = card.querySelector('.branch-remove');
            if (rm) rm.style.display = kind === 'if' ? 'none' : '';
            updateBranchHeaderSummary(card);
        });
        updateRuleSummary();
    }

    function addBranchRow(kind, data) {
        var list = document.getElementById('branches-list');
        var id = 'branch-' + (++_branchCounter);
        var badge = branchBadge(kind);
        var card = document.createElement('div');
        card.className = 'branch-card fade-in';
        card.id = id;
        card.setAttribute('data-kind', kind);
        markSortable(card);

        var conditionsHtml = '';
        if (kind !== 'else') {
            var rootMode = (data && data.condition_mode) || 'and';
            if (rootMode !== 'and' && rootMode !== 'or' && rootMode !== 'not') rootMode = 'and';
            conditionsHtml =
                '<div class="p-3 border-b border-gray-100">' +
                '<div class="flex items-center justify-between mb-2">' +
                '<div class="flex items-center gap-2">' +
                '<span class="badge-soft condition-badge">CONDITIONS</span>' +
                '</div>' +
                '<div class="flex gap-1">' +
                '<button onclick="window._branchAddCond(\'' + id + '\', \'leaf\')" class="px-2 py-1 bg-indigo-500 text-white text-xs font-medium rounded-md hover:bg-indigo-600 transition-colors"><i class="fas fa-plus mr-1"></i>Condition</button>' +
                '<button onclick="window._branchAddCond(\'' + id + '\', \'group\')" class="px-2 py-1 bg-indigo-400 text-white text-xs font-medium rounded-md hover:bg-indigo-500 transition-colors"><i class="fas fa-layer-group mr-1"></i>Group</button>' +
                '</div>' +
                '</div>' +
                '<div class="cond-root">' +
                '<div class="cond-root-bar">' +
                '<select class="root-mode border border-indigo-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onRootModeChange(\'' + id + '\')">' +
                '<option value="and"' + (rootMode === 'and' ? ' selected' : '') + '>ALL (AND)</option>' +
                '<option value="or"' + (rootMode === 'or' ? ' selected' : '') + '>ANY (OR)</option>' +
                '<option value="not"' + (rootMode === 'not' ? ' selected' : '') + '>NOT</option>' +
                '</select>' +
                '<span class="text-xs text-indigo-700 root-hint"></span>' +
                '</div>' +
                '<div class="cond-list space-y-2" data-sortable-list="1"></div>' +
                '<p class="no-conditions text-xs text-gray-400 italic py-1" style="display:none">No conditions — matches whenever a trigger fires</p>' +
                '</div>' +
                '</div>';
        } else {
            conditionsHtml = '';
        }

        card.innerHTML =
            '<div class="branch-header" onclick="window._toggleBranch(\'' + id + '\')">' +
            dragHandleHtml() +
            '<span class="' + badge.cls + ' badge-soft">' + badge.label + '</span>' +
            '<span class="branch-summary text-xs text-gray-500 flex-1 truncate">0 actions</span>' +
            '<button class="branch-remove p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded relative z-10" onclick="event.stopPropagation(); window._removeBranch(\'' + id + '\')" title="Remove branch"><i class="fas fa-times"></i></button>' +
            '<i class="fas fa-chevron-down chevron text-xs"></i>' +
            '</div>' +
            '<div class="branch-body">' +
            conditionsHtml +
            '<div class="p-3">' +
            '<div class="flex items-center justify-between mb-2">' +
            '<div class="flex items-center">' +
            '<span class="badge-soft action-badge">ACTIONS</span>' +
            '</div>' +
            '<button onclick="window._branchAddAction(\'' + id + '\')" class="px-2 py-1 bg-emerald-500 text-white text-xs font-medium rounded-md hover:bg-emerald-600 transition-colors"><i class="fas fa-plus mr-1"></i>Action</button>' +
            '</div>' +
            '<div class="act-list space-y-2" data-sortable-list="1"></div>' +
            '<p class="no-actions text-xs text-gray-400 italic py-1" style="display:none">No actions defined</p>' +
            '</div>' +
            '</div>';

        // Always insert ELSE last
        var elseCard = list.querySelector('[data-kind="else"]');
        if (elseCard && kind !== 'else') list.insertBefore(card, elseCard);
        else list.appendChild(card);

        if (kind !== 'else') {
            var condList = card.querySelector('.cond-list');
            renderConditionTree(condList, (data && data.conditions) || []);
            var noC = card.querySelector('.no-conditions');
            if (noC) noC.style.display = condList.children.length ? 'none' : '';
            refreshRootMode(card);
        }
        var actList = card.querySelector('.act-list');
        (data && data.actions || []).forEach(function(a) { addActionRow(actList, a); });
        var noA = card.querySelector('.no-actions');
        if (noA) noA.style.display = actList.children.length ? 'none' : '';

        // New branch opens; previous ones closed (accordion)
        var listAll = document.getElementById('branches-list');
        if (listAll) listAll.querySelectorAll('.branch-card').forEach(function(c) {
            if (c !== card) c.classList.remove('open');
        });
        card.classList.add('open');
        updateBranchControls();
        return card;
    }

    window._removeBranch = function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
        var list = document.getElementById('branches-list');
        if (list && !list.querySelector('.branch-card.open')) {
            var first = list.querySelector('.branch-card');
            if (first) first.classList.add('open');
        }
        updateBranchControls();
    };

    window._branchAddCond = function(branchId, kind) {
        var card = document.getElementById(branchId);
        if (!card) return;
        var list = card.querySelector('.cond-list');
        if (kind === 'group') addConditionGroup(list, null);
        else addConditionLeaf(list, null);
        card.classList.add('open');
        var noC = card.querySelector('.no-conditions');
        if (noC) noC.style.display = list.children.length ? 'none' : '';
        refreshRootMode(card);
        updateBranchHeaderSummary(card);
        updateRuleSummary();
    };

    window._branchAddAction = function(branchId) {
        var card = document.getElementById(branchId);
        if (!card) return;
        var list = card.querySelector('.act-list');
        addActionRow(list, null);
        card.classList.add('open');
        var noA = card.querySelector('.no-actions');
        if (noA) noA.style.display = list.children.length ? 'none' : '';
        updateBranchHeaderSummary(card);
        updateRuleSummary();
    };

    window.addBranch = function(kind) {
        if (kind === 'else') {
            var listE = document.getElementById('branches-list');
            if (listE.querySelector('[data-kind="else"]')) return;
            addBranchRow('else', null);
            return;
        }
        addBranchRow(kind, null);
    };

    function refreshRootMode(card) {
        if (!card) return;
        var sel = card.querySelector('.root-mode');
        if (!sel) return;
        var mode = sel.value || 'and';
        var list = card.querySelector('.cond-list');
        var n = list ? list.children.length : 0;
        var hint = card.querySelector('.root-hint');
        var hints = {
            and: 'every item must match',
            or: 'any item may match',
            not: 'invert the single item'
        };
        if (hint) hint.textContent = hints[mode] || '';
        var addGroupBtn = card.querySelector('.branch-body button[onclick*="\'group\'"]');
        var addLeafBtn = card.querySelector('.branch-body button[onclick*="\'leaf\'"]');
        if (mode === 'not') {
            if (addGroupBtn) addGroupBtn.style.display = 'none';
            if (addLeafBtn) addLeafBtn.style.display = n >= 1 ? 'none' : '';
            if (list && list.children.length > 1) {
                while (list.children.length > 1) list.removeChild(list.lastElementChild);
            }
        } else {
            if (addGroupBtn) addGroupBtn.style.display = '';
            if (addLeafBtn) addLeafBtn.style.display = '';
        }
        var noC = card.querySelector('.no-conditions');
        if (noC) noC.style.display = list && list.children.length ? 'none' : '';
        updateBranchHeaderSummary(card);
        updateRuleSummary();
    }

    window._onRootModeChange = function(branchId) {
        var card = document.getElementById(branchId);
        if (card) refreshRootMode(card);
    };

    function collectBranches() {
        var list = document.getElementById('branches-list');
        var out = [];
        list.querySelectorAll('.branch-card').forEach(function(card) {
            var kind = card.getAttribute('data-kind') || 'if';
            var branch = {
                id: card.id,
                kind: kind,
                condition_mode: 'and',
                conditions: [],
                actions: collectActions(card.querySelector('.act-list')),
            };
            if (kind !== 'else') {
                var modeSel = card.querySelector('.root-mode');
                if (modeSel) branch.condition_mode = modeSel.value || 'and';
                branch.conditions = collectConditionTree(card.querySelector('.cond-list'));
            }
            out.push(branch);
        });
        return out;
    }

    // ===== RULE LIST =====

    function summarizeTrigger(t) {
        var def = TRIGGER_DEFS[t.type] || {};
        var label = def.label || t.type || '?';
        var tLabel = getTargetLabel(t.target_id);
        var eb = [];
        var cfg = t.config || t;
        if (cfg.door_action) eb.push(cfg.door_action);
        if (cfg.trigger_time) eb.push('@ ' + cfg.trigger_time);
        if (cfg.trigger_days) eb.push(cfg.trigger_days);
        var extra = eb.length ? ' (' + esc(eb.join(', ')) + ')' : '';
        return esc(label) + (tLabel ? ' → <span class="font-medium text-amber-700">' + esc(tLabel) + '</span>' : '') + extra;
    }

    function renderRules() {
        var c = document.getElementById('rules-container');
        if (!rules.length) {
            c.innerHTML =
                '<div class="empty-state">' +
                '<i class="fas fa-bolt text-5xl text-amber-300 mb-4"></i>' +
                '<h3 class="text-lg font-semibold text-gray-700 mb-1">No automation rules yet</h3>' +
                '<p class="text-sm text-gray-500 mb-4">Create your first rule to automate your lights and sensors</p>' +
                '<button onclick="window._openCreateModal()" class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors inline-flex items-center text-sm">' +
                '<i class="fas fa-plus mr-2"></i>Create First Rule</button></div>';
            return;
        }
        c.innerHTML = rules.map(function(r) {
            var triggers = r.triggers || [];
            var branches = r.branches || [];
            var trigSummaries = triggers.length
                ? triggers.map(summarizeTrigger).join('<br>')
                : '<span class="text-gray-400 italic">No triggers</span>';
            var totalActions = branches.reduce(function(n, b) { return n + ((b.actions || []).length); }, 0);
            var totalConds = branches.reduce(function(n, b) { return n + ((b.conditions || []).length); }, 0);
            var lastUsed = r.last_fired ? formatTime(r.last_fired) : 'Never';
            var cardClass = 'rule-card bg-white rounded-xl shadow-sm border border-gray-200 p-5 ' + (r.enabled ? '' : 'opacity-60');
            var badgeClass = r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500';
            return '<div class="' + cardClass + '" data-rule-id="' + esc(r.id) + '">' +
                '<div class="flex items-center justify-between">' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-3 mb-1">' +
                '<h3 class="font-semibold text-gray-900 truncate">' + esc(r.name) + '</h3>' +
                '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClass + '">' + (r.enabled ? 'Enabled' : 'Disabled') + '</span>' +
                '</div>' +
                '<div class="text-xs text-gray-500 mt-1">' + trigSummaries + '</div>' +
                '<div class="flex items-center gap-4 text-sm text-gray-500 mt-2 flex-wrap">' +
                '<span><i class="fas fa-shield-halved text-indigo-400 mr-1"></i>' + totalConds + ' condition(s)</span>' +
                '<span><i class="fas fa-play-circle text-emerald-400 mr-1"></i>' + totalActions + ' action(s)</span>' +
                '<span class="text-xs text-gray-400">Last: ' + esc(lastUsed) + '</span>' +
                '</div></div>' +
                '<div class="flex items-center gap-2 ml-4 flex-shrink-0">' +
                '<button onclick="window._testRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors" title="Test conditions and matched branch actions"><i class="fas fa-play mr-1"></i>Test</button>' +
                '<button onclick="window._editRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors" title="Edit"><i class="fas fa-edit mr-1"></i>Edit</button>' +
                '<button onclick="window._deleteRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors" title="Delete"><i class="fas fa-trash"></i></button>' +
                '<label class="toggle-switch ml-1"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="window._toggleRule(\'' + r.id + '\')"><span class="toggle-slider"></span></label>' +
                '</div></div></div>';
        }).join('');
    }

    // ===== MODAL / SAVE =====

    window._openCreateModal = function() {
        editingRuleId = null;
        document.getElementById('modal-title').textContent = 'Create New Rule';
        document.getElementById('rule-name').value = '';
        document.getElementById('rule-enabled').checked = true;
        document.getElementById('rule-cooldown').value = '0.1';
        document.getElementById('triggers-list').innerHTML = '';
        document.getElementById('branches-list').innerHTML = '';
        _trigCounter = 0; _branchCounter = 0; _condCounter = 0; _actCounter = 0;
        addTriggerRow(null);
        addBranchRow('if', null);
        updateTriggerEmpty();
        updateBranchControls();
        setModalDefaults();
        document.getElementById('rule-modal').classList.remove('hidden');
    };

    window.closeModal = function() {
        document.getElementById('rule-modal').classList.add('hidden');
        editingRuleId = null;
    };

    window._editRule = function(id) {
        var rule = null;
        rules.forEach(function(r) { if (r.id === id) rule = r; });
        if (!rule) return;
        editingRuleId = id;
        document.getElementById('modal-title').textContent = 'Edit Rule';
        document.getElementById('rule-name').value = rule.name || '';
        document.getElementById('rule-enabled').checked = rule.enabled;
        document.getElementById('rule-cooldown').value = String(rule.cooldown_seconds || 0);
        document.getElementById('triggers-list').innerHTML = '';
        document.getElementById('branches-list').innerHTML = '';
        _trigCounter = 0; _branchCounter = 0; _condCounter = 0; _actCounter = 0;

        var triggers = rule.triggers || [];
        if (!triggers.length) addTriggerRow(null);
        else triggers.forEach(function(t) { addTriggerRow(t); });

        var branches = rule.branches || [];
        if (!branches.length) addBranchRow('if', null);
        else branches.forEach(function(b) { addBranchRow(b.kind || 'if', b); });

        updateTriggerEmpty();
        updateBranchControls();
        setModalDefaults();
        document.getElementById('rule-modal').classList.remove('hidden');
    };

    window._saveRule = function() { window.saveRule(); };

    window.saveRule = function() {
        var name = document.getElementById('rule-name').value.trim();
        if (!name) { showToast('Validation', 'Please enter a rule name.', 'error'); return; }
        var enabled = document.getElementById('rule-enabled').checked;
        var cdEl = document.getElementById('rule-cooldown');
        var cooldown = cdEl ? parseFloat(cdEl.value) : 0;
        if (isNaN(cooldown) || cooldown < 0) cooldown = 0;

        var triggers = collectTriggers();
        if (!triggers.length) { showToast('Validation', 'Please add at least one trigger.', 'error'); return; }
        for (var i = 0; i < triggers.length; i++) {
            var def = TRIGGER_DEFS[triggers[i].type];
            if (def && def.showTarget && !triggers[i].target_id) {
                showToast('Validation', 'Please select a target for trigger ' + (i + 1) + '.', 'error');
                return;
            }
        }

        var branches = collectBranches();
        if (!branches.length) { showToast('Validation', 'Please add at least one branch.', 'error'); return; }
        if (branches[0].kind !== 'if') { showToast('Validation', 'First branch must be IF.', 'error'); return; }
        for (var j = 0; j < branches.length; j++) {
            if (!branches[j].actions.length) {
                showToast('Validation', 'Branch ' + (j + 1) + ' needs at least one action.', 'error');
                return;
            }
            if (branches[j].kind === 'else' && j !== branches.length - 1) {
                showToast('Validation', 'ELSE must be the last branch.', 'error');
                return;
            }
        }

        var body = {
            name: name,
            enabled: enabled,
            schema_version: 2,
            cooldown_seconds: cooldown,
            triggers: triggers,
            branches: branches
        };
        var url = editingRuleId ? '/plugins/automations/api/rules/' + editingRuleId : '/plugins/automations/api/rules';
        var method = editingRuleId ? 'PUT' : 'POST';
        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function(res) {
            if (!res.ok) return res.json().then(function(j) { throw new Error(j.error || ('Save failed (' + res.status + ')')); });
            return res.json();
        })
        .then(function() {
            var msg = editingRuleId ? 'Rule updated.' : 'Rule created.';
            closeModal();
            showToast('Success', msg);
            loadRules();
        })
        .catch(function(err) {
            showToast('Error', 'Failed to save rule: ' + err.message, 'error');
        });
    };

    window._toggleRule = function(id) {
        fetch('/plugins/automations/api/rules/' + id + '/toggle', { method: 'POST' })
        .then(function(res) {
            if (!res.ok) throw new Error('Toggle failed');
            return res.json();
        })
        .then(function() { loadRules(); })
        .catch(function(err) {
            showToast('Error', 'Failed to toggle rule: ' + err.message, 'error');
        });
    };

    window._deleteRule = function(id) {
        deletingRuleId = id;
        var rule = null;
        rules.forEach(function(r) { if (r.id === id) rule = r; });
        var nameEl = document.getElementById('delete-rule-name');
        if (nameEl) nameEl.textContent = rule ? rule.name : id;
        document.getElementById('delete-modal').classList.remove('hidden');
    };

    window.closeDeleteModal = function() {
        deletingRuleId = null;
        document.getElementById('delete-modal').classList.add('hidden');
    };

    window.confirmDelete = function() {
        if (!deletingRuleId) return;
        var id = deletingRuleId;
        closeDeleteModal();
        fetch('/plugins/automations/api/rules/' + id, { method: 'DELETE' })
        .then(function(res) {
            if (!res.ok) throw new Error('Delete failed');
            return res.json();
        })
        .then(function() { loadRules(); showToast('Deleted', 'Rule deleted.'); })
        .catch(function(err) {
            showToast('Error', 'Failed to delete rule: ' + err.message, 'error');
        });
    };

    window._testRule = function(id) {
        fetch('/plugins/automations/api/rules/' + id + '/test', { method: 'POST' })
        .then(function(res) {
            if (!res.ok) return res.json().then(function(j) { throw new Error(j.error || 'Test failed'); });
            return res.json();
        })
        .then(function(data) {
            if (!data.matched) {
                showToast('Test', 'No conditions matched.', 'warning');
                return;
            }
            if (data.success) {
                showToast('Test', 'Run successfully.');
            } else {
                showToast('Test', 'Run failed.', 'warning');
            }
        })
        .catch(function(err) {
            showToast('Error', 'Failed to test rule: ' + err.message, 'error');
        });
    };

    window.openCreateModal = window._openCreateModal;
    window.addCondition = function() {
        var list = document.getElementById('branches-list');
        var first = list && list.querySelector('.branch-card .cond-list');
        if (first) addConditionLeaf(first, null);
    };
    window.addAction = function() {
        var list = document.getElementById('branches-list');
        var first = list && list.querySelector('.branch-card .act-list');
        if (first) addActionRow(first, null);
    };

    loadTargets().then(function() {
        loadRules();
        setInterval(pollRules, 1000);
    });
})();
