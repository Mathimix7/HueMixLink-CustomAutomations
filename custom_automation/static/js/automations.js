/* Custom Automations - HueMix-Link */
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

    var rules = [];
    var targets = {};
    var editingRuleId = null;
    var deletingRuleId = null;
    var _uid = 0;
    function uid() { return ++_uid; }

    function loadRules() {
        fetch('/plugins/automations/api/rules')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                rules = data.rules || [];
                renderRules();
            })
            .catch(function() {
                document.getElementById('rules-container').innerHTML =
                    '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-3"></i><p class="text-red-500">Failed to load rules</p></div>';
            });
    }

    function loadTargets() {
        return fetch('/plugins/automations/api/available_targets')
            .then(function(res) { return res.json(); })
            .then(function(data) { targets = data; })
            .catch(function() {
                targets = { lights: [], rooms: [], zones: [], motion_sensors: [], door_sensors: [], scenes: [] };
            });
    }

    function populateSelect(sel, category, selectedValue) {
        sel.innerHTML = '<option value="">Select...</option>';
        if (!category) return;
        var items = targets[category] || [];
        var key = (category === 'motion_sensors' || category === 'door_sensors') ? 'mac' : 'id';
        items.forEach(function(item) {
            var opt = document.createElement('option');
            opt.value = item[key];
            opt.textContent = item.name || item[key];
            if (String(item[key]) === String(selectedValue)) opt.selected = true;
            sel.appendChild(opt);
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

    function getCondSelectedGroupId(id) {
        var row = document.getElementById(id);
        if (!row) return '';
        var targetSel = row.querySelector('.cond-target');
        return targetSel ? targetSel.value : '';
    }

    function getActSelectedGroupId(id) {
        var row = document.getElementById(id);
        if (!row) return '';
        var entityEl = row.querySelector('.act-entity');
        return entityEl ? entityEl.value : '';
    }

    window._onCondEntityChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var sceneSel = row.querySelector('.cond-scene');
        if (sceneSel) {
            var groupId = getCondSelectedGroupId(id);
            var prev = sceneSel.value;
            populateSceneSelect(sceneSel, prev, groupId);
        }
    };

    window._onActEntityChange = function(id) {
        var row = document.getElementById(id);
        if (!row) return;
        var sceneSel = row.querySelector('.act-scene');
        if (sceneSel) {
            var groupId = getActSelectedGroupId(id);
            var prev = sceneSel.value;
            populateSceneSelect(sceneSel, prev, groupId);
        }
    };

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

    function buildGroupedSelectHtml(items, key, selectedValue, groupByRoom) {
        if (!groupByRoom) {
            var html = '';
            items.forEach(function(item) {
                var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
            return html;
        }
        var roomGroups = {};
        var ungrouped = [];
        items.forEach(function(item) {
            var rid = item.room_id || '';
            if (rid) {
                if (!roomGroups[rid]) roomGroups[rid] = [];
                roomGroups[rid].push(item);
            } else {
                ungrouped.push(item);
            }
        });
        var allGroups = (targets.rooms || []).concat(targets.zones || []);
        var html = '';
        allGroups.forEach(function(g) {
            var lights = roomGroups[g.id];
            if (!lights || !lights.length) return;
            html += '<optgroup label="' + esc(g.name || g.id) + '">';
            lights.forEach(function(item) {
                var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
            html += '</optgroup>';
        });
        if (ungrouped.length) {
            html += '<optgroup label="Other">';
            ungrouped.forEach(function(item) {
                var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
            html += '</optgroup>';
        }
        return html;
    }

    function buildMultiCatSelectHtml(cats, selectedValue) {
        var html = '';
        cats.forEach(function(cat) {
            if (!cat) return;
            var items = targets[cat] || [];
            var key = (cat === 'motion_sensors' || cat === 'door_sensors') ? 'mac' : 'id';
            var label = cat === 'zones' ? 'Zones' : cat === 'rooms' ? 'Rooms' : cat === 'lights' ? 'Lights' : cat;
            html += '<optgroup label="' + esc(label) + '">';
            items.forEach(function(item) {
                var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
            html += '</optgroup>';
        });
        return html;
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function formatTime(iso) { try { return new Date(iso).toLocaleString(); } catch(e) { return iso || ''; } }

    function renderDayCheckboxes(containerId, selectedDays, cssColor) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var selected = {};
        if (selectedDays) {
            selectedDays.split(',').forEach(function(d) { selected[d.trim()] = true; });
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

    function updateEmptyStates() {
        var condList = document.getElementById('conditions-list');
        var actList = document.getElementById('actions-list');
        var noCond = document.getElementById('no-conditions');
        var noAct = document.getElementById('no-actions');
        if (condList && noCond) {
            noCond.style.display = condList.children.length ? 'none' : '';
        }
        if (actList && noAct) {
            noAct.style.display = actList.children.length ? 'none' : '';
        }
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
            var td = TRIGGER_DEFS[r.trigger.type] || {};
            var tLabel = getTargetLabel(r.trigger.target_id);
            var eb = [];
            if (r.trigger.door_action) eb.push(r.trigger.door_action);
            if (r.trigger.trigger_time) eb.push('@ ' + r.trigger.trigger_time);
            if (r.trigger.trigger_days) eb.push(r.trigger.trigger_days);
            var extraStr = eb.length ? ' <span class="text-gray-400 text-xs">(' + esc(eb.join(', ')) + ')</span>' : '';
            var cardClass = 'rule-card bg-white rounded-xl shadow-sm border border-gray-200 p-5 ' + (r.enabled ? '' : 'opacity-60');
            var badgeClass = r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500';
            return '<div class="' + cardClass + '">' +
                '<div class="flex items-center justify-between">' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-3 mb-1">' +
                '<h3 class="font-semibold text-gray-900 truncate">' + esc(r.name) + '</h3>' +
                '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClass + '">' + (r.enabled ? 'Enabled' : 'Disabled') + '</span>' +
                '</div>' +
                '<div class="flex items-center gap-4 text-sm text-gray-500 flex-wrap">' +
                '<span class="inline-flex items-center gap-1">' +
                '<span class="trigger-badge text-white text-[10px] font-bold px-1.5 py-0 rounded">TRIG</span> ' +
                esc(td.label || r.trigger.type) +
                (tLabel ? ' <span class="text-gray-400">&rarr;</span> <span class="font-medium text-amber-700">' + esc(tLabel) + '</span>' : '') +
                '</span>' +
                extraStr +
                '</div>' +
                '<div class="flex items-center gap-4 text-sm text-gray-500 mt-1">' +
                (r.conditions.length ? '<span><i class="fas fa-shield-halved text-indigo-400 mr-1"></i>' + r.conditions.length + ' cond.</span>' : '') +
                '<span><i class="fas fa-play-circle text-emerald-400 mr-1"></i>' + r.actions.length + ' action(s)</span>' +
                (r.last_fired ? '<span class="text-xs text-gray-400">Last: ' + formatTime(r.last_fired) + ' (' + r.fire_count + 'x)</span>' : '') +
                '</div></div>' +
                '<div class="flex items-center gap-2 ml-4 flex-shrink-0">' +
                '<button onclick="window._testRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors" title="Test"><i class="fas fa-play mr-1"></i>Test</button>' +
                '<button onclick="window._editRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors" title="Edit"><i class="fas fa-edit mr-1"></i>Edit</button>' +
                '<button onclick="window._deleteRule(\'' + r.id + '\')" class="px-2.5 py-1 text-xs bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors" title="Delete"><i class="fas fa-trash"></i></button>' +
                '<label class="toggle-switch ml-1"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="window._toggleRule(\'' + r.id + '\')"><span class="toggle-slider"></span></label>' +
                '</div></div></div>';
        }).join('');
    }

    function buildTriggerSection(type, data) {
        var def = TRIGGER_DEFS[type];
        if (!def) return '';
        var html = '';
        if (def.showTarget) {
            html += '<div class="mb-3">' +
                '<label class="block text-sm font-medium text-gray-700 mb-1">Target</label>' +
                '<select id="trigger-target" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">' +
                '<option value="">Select target...</option></select></div>';
        }
        if (type === 'light_state_change' || type === 'room_state_change') {
            var props = def.triggerProperties || [];
            var savedAttrs = (data && data.attributes) || [];
            var savedWanted = (data && data.wanted_state) || '';
            var savedTP = (data && data.triggerProperties) || null;
            html += '<div class="mb-3">' +
                '<label class="block text-sm font-medium text-gray-700 mb-1">Watch for</label>' +
                '<div class="flex flex-wrap gap-2">';
            props.forEach(function(p) {
                var lbl = ATTR_LABELS[p] || p;
                var isChecked = false;
                if (savedTP) {
                    isChecked = savedTP.indexOf(p) >= 0;
                } else if (p === 'on') {
                    isChecked = savedWanted === 'on';
                } else if (p === 'off') {
                    isChecked = savedWanted === 'off';
                } else {
                    isChecked = savedAttrs.indexOf(p) >= 0;
                }
                var checked = isChecked ? ' checked' : '';
                html += '<label class="inline-flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 cursor-pointer hover:bg-gray-100">' +
                    '<input type="checkbox" class="trigger-prop-cb rounded border-gray-300 text-amber-500 focus:ring-amber-500" value="' + p + '"' + checked + '> ' + lbl + '</label>';
            });
            html += '</div></div>';
        }
        if (def.extraFields) {
            def.extraFields.forEach(function(f) {
                html += '<div class="mb-3"><label class="block text-sm font-medium text-gray-700 mb-1">' + esc(f.label) + '</label>';
                if (f.type === 'select') {
                    html += '<select id="trigger-extra-' + f.key + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">';
                    f.options.forEach(function(o) {
                        var sel = (data && data[f.key] === o.value) ? ' selected' : '';
                        html += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
                    });
                    html += '</select>';
                } else if (f.type === 'time') {
                    var val = (data && data[f.key]) || f.defaultValue || '07:00';
                    html += '<input type="time" id="trigger-extra-' + f.key + '" value="' + esc(val) + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">';
                } else if (f.type === 'day_checkboxes') {
                    html += '<div id="trigger-days-container" class="mt-1"></div>';
                }
                html += '</div>';
            });
        }
        return html;
    }

    function rebuildTargetSelect(type, selectedId) {
        var def = TRIGGER_DEFS[type];
        var sel = document.getElementById('trigger-target');
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
                var og = document.createElement('optgroup');
                og.label = 'Other';
                ungrouped.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.id;
                    opt.textContent = item.name || item.id;
                    if (String(item.id) === String(selectedId)) opt.selected = true;
                    og.appendChild(opt);
                });
                sel.appendChild(og);
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

    window._onTriggerRoomFilterChange = function() {
        var typeEl = document.getElementById('trigger-type');
        var type = typeEl ? typeEl.value : '';
        var targetEl = document.getElementById('trigger-target');
        var prevTarget = targetEl ? targetEl.value : '';
        rebuildTargetSelect(type, prevTarget);
    };

    window._onTriggerTypeChange = function(preset) {
        var type = document.getElementById('trigger-type').value;
        var section = document.getElementById('trigger-config');
        if (!type || !TRIGGER_DEFS[type]) {
            section.innerHTML = '<p class="text-sm text-gray-400 italic">Select a trigger type above to configure it.</p>';
            return;
        }
        var triggerData = (preset && preset.type === type) ? preset : {};
        section.innerHTML = buildTriggerSection(type, triggerData);
        if (TRIGGER_DEFS[type].showTarget) {
            rebuildTargetSelect(type, preset && preset.type === type ? preset.target_id : '');
        }
        var dayCont = document.getElementById('trigger-days-container');
        if (dayCont) {
            var dayData = (preset && preset.type === type) ? (preset.trigger_days || preset.trigger_time || '') : 'monday,tuesday,wednesday,thursday,friday';
            renderDayCheckboxes('trigger-days-container', dayData, 'amber');
        }
    };

    var _condCounter = 0;
    var _actCounter = 0;

    function buildCondEntitySelect(id, cat, selectedValue) {
        var catDef = COND_CATEGORIES[cat];
        if (!catDef || !catDef.targetCategory) return '';
        var items = targets[catDef.targetCategory] || [];
        var key = (catDef.targetCategory === 'motion_sensors' || catDef.targetCategory === 'door_sensors') ? 'mac' : 'id';
        var groupByRoom = (catDef.targetCategory === 'lights');
        var html = '<select class="cond-target border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondEntityChange(\'' + id + '\')">';
        html += '<option value="">Select ' + esc(catDef.label.toLowerCase()) + '...</option>';
        if (groupByRoom) {
            html += buildGroupedSelectHtml(items, key, selectedValue, true);
        } else {
            items.forEach(function(item) {
                var sel = (String(item[key]) === String(selectedValue || '')) ? ' selected' : '';
                html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
            });
        }
        html += '</select>';
        return html;
    }

    function mapConditionToUI(cond) {
        var result = { _category: '', _property: '', _propValue: '', target_id: cond.target_id || '' };
        var t = cond.type || '';
        if (t === 'light_is_on' || t === 'light_is_off') {
            result._category = 'light';
            result._property = 'state';
            result._propValue = t === 'light_is_on' ? 'on' : 'off';
        } else if (t === 'room_is_on' || t === 'room_is_off') {
            result._category = 'room';
            result._property = 'state';
            result._propValue = t === 'room_is_on' ? 'on' : 'off';
        } else if (t === 'door_is_open' || t === 'door_is_closed') {
            result._category = 'door';
            result._property = 'state';
            result._propValue = t === 'door_is_open' ? 'open' : 'closed';
        } else if (t === 'brightness_above' || t === 'brightness_below') {
            result._category = cond.target_type || 'light';
            result._property = 'brightness';
            result._propValue = (cond.operator || '>') + '|' + (cond.value !== undefined ? cond.value : 50);
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
        }
        return result;
    }

    window._addCondition = function(data) {
        var id = 'cond-' + (++_condCounter);
        var container = document.getElementById('conditions-list');
        var row = document.createElement('div');
        row.className = 'condition-item bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2';
        row.id = id;
        var restored = data ? mapConditionToUI(data) : null;
        var catOptions = '<option value="">Select category...</option>';
        Object.keys(COND_CATEGORIES).forEach(function(k) {
            var c = COND_CATEGORIES[k];
            var sel = (restored && restored._category === k) ? ' selected' : '';
            catOptions += '<option value="' + k + '"' + sel + '>' + esc(c.label) + '</option>';
        });
        var html = '<div class="flex items-start gap-2">' +
            '<div class="flex-1">' +
            '<div class="flex gap-2 items-center mb-2">' +
            '<select class="cond-cat border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondCatChange(\'' + id + '\')">' +
            catOptions + '</select>' +
            '<div class="cond-entity-wrap"></div>' +
            '<span class="text-gray-400 text-sm">where</span>' +
            '<div class="cond-props-wrap flex-1"></div>' +
            '</div>' +
            '<div class="cond-detail-wrap"></div>' +
            '</div>' +
            '<button onclick="window._removeCondition(\'' + id + '\')" class="mt-1 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove condition"><i class="fas fa-times"></i></button>' +
            '</div>';
        row.innerHTML = html;
        container.appendChild(row);
        if (restored) {
            window._populateCondProps(id, restored._category, data);
        }
        updateEmptyStates();
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
        var restoredProp = data ? (mapConditionToUI(data)._property || '') : '';
        var restoredPropValue = data ? (mapConditionToUI(data)._propValue || '') : '';
        if (catDef.skipProperty) {
            wrap.innerHTML = '';
            var props = COND_PROPERTIES[cat];
            var firstKey = Object.keys(props)[0];
            if (firstKey) {
                window._renderCondPropDetail(id, cat, firstKey, data);
            }
            return;
        }
        var props = COND_PROPERTIES[cat];
        if (!props) return;
        var html = '<select class="cond-prop border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="window._onCondPropChange(\'' + id + '\')">';
        html += '<option value="">Select property...</option>';
        Object.keys(props).forEach(function(k) {
            var sel = (restoredProp === k) ? ' selected' : '';
            html += '<option value="' + k + '"' + sel + '>' + esc(props[k].label) + '</option>';
        });
        html += '</select>';
        wrap.innerHTML = html;
        if (restoredProp && props[restoredProp]) {
            window._renderCondPropDetail(id, cat, restoredProp, data);
        }
    };

    window._renderCondPropDetail = function(id, cat, prop, data) {
        var row = document.getElementById(id);
        if (!row) return;
        var detailWrap = row.querySelector('.cond-detail-wrap');
        var propDef = COND_PROPERTIES[cat] && COND_PROPERTIES[cat][prop];
        if (!propDef) { detailWrap.innerHTML = ''; return; }
        var restoredPropValue = data ? (mapConditionToUI(data)._propValue || '') : '';
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
            var parts = restoredPropValue.split('|');
            var start = parts[0] || '07:00';
            var end = parts[1] || '23:00';
            html += '<div class="flex items-center gap-2">' +
                '<input type="time" class="cond-time-start border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" value="' + esc(start) + '">' +
                '<span class="text-sm text-gray-500">to</span>' +
                '<input type="time" class="cond-time-end border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" value="' + esc(end) + '">' +
                '</div>';
        } else if (propDef.type === 'day_checkboxes') {
            html += '<div id="' + id + '-day-cbs" class="mt-1"></div>';
        } else if (propDef.type === 'scene_select') {
            html += '<select class="cond-scene border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></select>';
        }
        detailWrap.innerHTML = html;
        if (propDef.type === 'day_checkboxes') {
            renderDayCheckboxes(id + '-day-cbs', restoredPropValue || 'monday,tuesday,wednesday,thursday,friday', 'indigo');
        }
        if (propDef.type === 'scene_select') {
            var sel = detailWrap.querySelector('.cond-scene');
            if (sel) {
                var groupId = getCondSelectedGroupId(id);
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

    window._removeCondition = function(id) {
        var row = document.getElementById(id);
        if (row) row.remove();
        updateEmptyStates();
    };

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

    window._addAction = function(data) {
        var id = 'act-' + (++_actCounter);
        var container = document.getElementById('actions-list');
        var row = document.createElement('div');
        row.className = 'action-item bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2';
        row.id = id;
        var restored = data ? mapActionToUI(data) : null;
        var catOptions = '<option value="">Select category...</option>';
        Object.keys(ACTION_CATEGORIES).forEach(function(k) {
            var c = ACTION_CATEGORIES[k];
            var sel = (restored && restored._category === k) ? ' selected' : '';
            catOptions += '<option value="' + k + '"' + sel + '>' + esc(c.label) + '</option>';
        });
        var html = '<div class="flex items-start gap-2">' +
            '<div class="flex-1">' +
            '<div class="flex gap-2 items-center mb-2 flex-wrap">' +
            '<select class="act-cat border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActCatChange(\'' + id + '\')">' +
            catOptions + '</select>' +
            '<div class="act-entity-wrap"></div>' +
            '<div class="act-type-wrap"></div>' +
            '</div>' +
            '<div class="act-extra-wrap"></div>' +
            '</div>' +
            '<button onclick="window._removeAction(\'' + id + '\')" class="mt-1 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove action"><i class="fas fa-times"></i></button>' +
            '</div>';
        row.innerHTML = html;
        container.appendChild(row);
        if (restored) {
            window._onActCatChange(id, data);
        }
        updateEmptyStates();
    };

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
            typeWrap.innerHTML = '<input type="number" class="act-delay-seconds border border-gray-300 rounded-lg px-3 py-2 text-sm w-28 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="Seconds" min="1" max="3600" value="' + esc(val) + '">';
            return;
        }
        if (cat === 'log') {
            var val = data && data.message ? data.message : '';
            typeWrap.innerHTML = '<input type="text" class="act-log-message border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="Log message..." value="' + esc(val) + '">';
            return;
        }
        if (catDef.targetCategory) {
            var items = targets[catDef.targetCategory] || [];
            var key = (catDef.targetCategory === 'motion_sensors' || catDef.targetCategory === 'door_sensors') ? 'mac' : 'id';
            var groupByRoom = (catDef.targetCategory === 'lights');
            var html = '<select class="act-entity border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActTypeChange(\'' + id + '\')">';
            html += '<option value="">Select ' + esc(catDef.label.toLowerCase()) + '...</option>';
            if (groupByRoom) {
                html += buildGroupedSelectHtml(items, key, restored ? restored._entity : '', true);
            } else {
                items.forEach(function(item) {
                    var sel = (restored && String(restored._entity) === String(item[key])) ? ' selected' : '';
                    html += '<option value="' + item[key] + '"' + sel + '>' + esc(item.name || item[key]) + '</option>';
                });
            }
            html += '</select>';
            entityWrap.innerHTML = html;
        }
        var actionTypes = ACTION_TYPES[cat];
        if (actionTypes) {
            var html = '<select class="act-type border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" onchange="window._onActTypeChange(\'' + id + '\')">';
            html += '<option value="">Select action...</option>';
            actionTypes.forEach(function(a) {
                var sel = (restored && restored._action === a.value) ? ' selected' : '';
                html += '<option value="' + a.value + '"' + sel + '>' + esc(a.label) + '</option>';
            });
            html += '</select>';
            typeWrap.innerHTML = html;
        }
        if (restored && restored._entity && restored._action) {
            window._onActTypeChange(id, data);
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
        var restored = data ? mapActionToUI(data) : null;
        if (cat === 'room' || cat === 'light' || cat === 'zone') {
            var actions = ACTION_TYPES[cat];
            var backendType = '';
            actions.forEach(function(a) { if (a.value === action) backendType = a.backendType; });
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
                var val = '';
                if (data && data.type === 'set_light_color') {
                    val = data.ct !== undefined ? data.ct : '';
                }
                extraWrap.innerHTML = '<div class="flex items-center gap-3 mt-2">' +
                    '<label class="text-sm text-gray-600">Color Temp:</label>' +
                    '<input type="number" class="act-ct border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" min="153" max="500" value="' + esc(val) + '">' +
                    '<span class="text-sm text-gray-500">K</span></div>';
            } else if (action === 'scene') {
                var val = '';
                if (data && data.type === 'call_scene') {
                    val = data.scene_id || '';
                }
                extraWrap.innerHTML = '<div class="flex items-center gap-3 mt-2">' +
                    '<label class="text-sm text-gray-600">Scene:</label>' +
                    '<select class="act-scene border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"></select></div>';
                var sel = extraWrap.querySelector('.act-scene');
                if (sel) {
                    var entityEl = row.querySelector('.act-entity');
                    var groupId = entityEl ? entityEl.value : '';
                    populateSceneSelect(sel, val, groupId);
                }
            }
        }
    };

    window._removeAction = function(id) {
        var row = document.getElementById(id);
        if (row) row.remove();
        updateEmptyStates();
    };

    function collectTrigger() {
        var typeEl = document.getElementById('trigger-type');
        var type = typeEl ? typeEl.value : '';
        var result = { type: type, config: {} };
        var def = TRIGGER_DEFS[type];
        if (!def) return result;
        if (def.showTarget) {
            var targetEl = document.getElementById('trigger-target');
            result.target_id = targetEl ? targetEl.value : '';
        }
        if (type === 'light_state_change' || type === 'room_state_change') {
            var cbs = document.querySelectorAll('.trigger-prop-cb');
            var props = [];
            cbs.forEach(function(cb) { if (cb.checked) props.push(cb.value); });
            result.triggerProperties = props;
            var attrs = [];
            var hasOn = props.indexOf('on') >= 0;
            var hasOff = props.indexOf('off') >= 0;
            if (hasOn && !hasOff) {
                result.config.wanted_state = 'on';
            } else if (hasOff && !hasOn) {
                result.config.wanted_state = 'off';
            }
            props.forEach(function(p) {
                attrs.push(p);
            });
            result.attributes = attrs;
        }
        if (def.extraFields) {
            def.extraFields.forEach(function(f) {
                if (f.type === 'select' || f.type === 'time') {
                    var el = document.getElementById('trigger-extra-' + f.key);
                    if (el) result.config[f.key] = el.value;
                } else if (f.type === 'day_checkboxes') {
                    var cbs = document.querySelectorAll('#trigger-days-container .day-cb');
                    var days = [];
                    cbs.forEach(function(cb) { if (cb.checked) days.push(cb.value); });
                    result.config.trigger_days = days.join(',');
                }
            });
        }
        return result;
    }

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
                else if (cat === 'room') cond.type = val === 'on' ? 'room_is_on' : 'room_is_off';
                else if (cat === 'zone') cond.type = val === 'on' ? 'room_is_on' : 'room_is_off';
            } else if (prop === 'brightness') {
                var opEl = el.querySelector('.cond-comp-op');
                var numEl = el.querySelector('.cond-comp-val');
                var op = opEl ? opEl.value : '>=';
                var num = numEl ? parseInt(numEl.value, 10) : 50;
                cond.type = op === '<' || op === '<=' ? 'brightness_below' : 'brightness_above';
                cond.operator = op;
                cond.value = num;
                cond.target_type = cat;
            } else if (prop === 'scene') {
                var sceneEl = el.querySelector('.cond-scene');
                cond.type = 'scene_active';
                cond.scene_id = sceneEl ? sceneEl.value : '';
                cond.target_type = cat;
            }
        } else if (cat === 'door') {
            var valEl = el.querySelector('.cond-value');
            var val = valEl ? valEl.value : 'open';
            cond.type = val === 'open' ? 'door_is_open' : 'door_is_closed';
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

    function collectConditions() {
        var rows = document.querySelectorAll('.condition-item');
        var conditions = [];
        rows.forEach(function(row) {
            var catEl = row.querySelector('.cond-cat');
            var cat = catEl ? catEl.value : '';
            var propEl = row.querySelector('.cond-prop');
            var prop = propEl ? propEl.value : '';
            if (cat) {
                conditions.push(collectConditionData(row, cat, prop));
            }
        });
        return conditions;
    }

    function collectActions() {
        var rows = document.querySelectorAll('.action-item');
        var actions = [];
        rows.forEach(function(row) {
            var catEl = row.querySelector('.act-cat');
            var cat = catEl ? catEl.value : '';
            if (!cat) return;
            if (cat === 'delay') {
                var secEl = row.querySelector('.act-delay-seconds');
                var secs = secEl ? parseInt(secEl.value, 10) : 1;
                if (isNaN(secs) || secs < 1) secs = 1;
                actions.push({ type: 'delay', seconds: secs });
                return;
            }
            if (cat === 'log') {
                var msgEl = row.querySelector('.act-log-message');
                actions.push({ type: 'log_message', message: msgEl ? msgEl.value : '' });
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
                    var brEl = row.querySelector('.act-brightness');
                    act.brightness = brEl ? parseInt(brEl.value, 10) : undefined;
                }
                if (backendType === 'set_light_brightness') {
                    var brEl = row.querySelector('.act-brightness');
                    var forceEl = row.querySelector('.act-force');
                    act.brightness = brEl ? parseInt(brEl.value, 10) : 50;
                    act.force = forceEl ? forceEl.checked : false;
                }
                if (backendType === 'set_light_color') {
                    var ctEl = row.querySelector('.act-ct');
                    act.ct = ctEl ? parseInt(ctEl.value, 10) : 300;
                }
            }
            actions.push(act);
        });
        return actions;
    }

    window._openCreateModal = function() {
        editingRuleId = null;
        document.getElementById('modal-title').textContent = 'Create New Rule';
        document.getElementById('rule-name').value = '';
        document.getElementById('rule-enabled').checked = true;
        var typeEl = document.getElementById('trigger-type');
        typeEl.value = '';
        document.getElementById('trigger-config').innerHTML = '<p class="text-sm text-gray-400 italic">Select a trigger type above to configure it.</p>';
        document.getElementById('conditions-list').innerHTML = '';
        document.getElementById('actions-list').innerHTML = '';
        _condCounter = 0;
        _actCounter = 0;
        updateEmptyStates();
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
        var typeEl = document.getElementById('trigger-type');
        typeEl.value = rule.trigger.type;
        window._onTriggerTypeChange(rule.trigger);
        document.getElementById('conditions-list').innerHTML = '';
        document.getElementById('actions-list').innerHTML = '';
        _condCounter = 0;
        _actCounter = 0;
        rule.conditions.forEach(function(c) { window._addCondition(c); });
        rule.actions.forEach(function(a) { window._addAction(a); });
        updateEmptyStates();
        document.getElementById('rule-modal').classList.remove('hidden');
    };

    window._saveRule = function() {
        window.saveRule();
    };

    window.saveRule = function() {
        var name = document.getElementById('rule-name').value.trim();
        if (!name) { showToast('Validation', 'Please enter a rule name.', 'error'); return; }
        var enabled = document.getElementById('rule-enabled').checked;
        var trigger = collectTrigger();
        if (!trigger.type) { showToast('Validation', 'Please select a trigger type.', 'error'); return; }
        var def = TRIGGER_DEFS[trigger.type];
        if (def && def.showTarget && !trigger.target_id) { showToast('Validation', 'Please select a target for the trigger.', 'error'); return; }
        var conditions = collectConditions();
        var actions = collectActions();
        if (!actions.length) { showToast('Validation', 'Please add at least one action.', 'error'); return; }
        var body = { name: name, enabled: enabled, trigger: trigger, conditions: conditions, actions: actions };
        var url = editingRuleId ? '/plugins/automations/api/rules/' + editingRuleId : '/plugins/automations/api/rules';
        var method = editingRuleId ? 'PUT' : 'POST';
        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('Save failed');
            return res.json();
        })
        .then(function() {
            closeModal();
            showToast('Success', editingRuleId ? 'Rule updated.' : 'Rule created.');
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
            if (!res.ok) throw new Error('Test failed');
            return res.json();
        })
        .then(function(data) {
            showToast('Test', data.message || 'Rule test executed successfully.');
        })
        .catch(function(err) {
            showToast('Error', 'Failed to test rule: ' + err.message, 'error');
        });
    };

    window.onTriggerTypeChange = window._onTriggerTypeChange;
    window.openCreateModal = window._openCreateModal;
    window.addCondition = window._addCondition;
    window.addAction = window._addAction;

    loadTargets().then(function() {
        loadRules();
    });
})();
