/* Deliberately ES5 and basic DOM/CSS for WebKit 537. No frameworks/storage. */
(function () {
    'use strict';
    var api = new VieraApi(XMLHttpRequest), view = 'login', stack = [], selected = null;
    var busy = false, serial = 0, telemetryKey = '', reported = {}, imageReports = [];
    var playingSession = null, progressTimer = null;
    var preferences = { mbps: 4, mode: 'hls', language: 'de' };
    var bitrateChoices = [1, 2, 4, 6, 8, 12];
    var playbackAttempt = 0;
    var video = document.getElementById('video');
    function el(id) { return document.getElementById(id); }
    function text(node, value) {
        while (node.firstChild) { node.removeChild(node.firstChild); }
        if (value !== null && typeof value !== 'undefined' && String(value) !== '') {
            node.appendChild(document.createTextNode(String(value)));
        }
    }
    function status(message, error) { text(el('status'), message); el('status').className = error ? 'error' : ''; }
    function report(event) {
        var key = event.indexOf('play_') === 0 ? event + ':' + playbackAttempt : event;
        if (!telemetryKey || reported[key]) { return; }
        reported[key] = true;
        var image = new Image(); imageReports.push(image);
        function support(type) {
            try { return video.canPlayType(type) || 'no'; } catch (e) { return 'unknown'; }
        }
        image.src = '/viera/event?key=' + encodeURIComponent(telemetryKey) + '&event=' + event +
            '&attempt=' + playbackAttempt + '&hls=' + support('application/vnd.apple.mpegurl') +
            '&mp4=' + support('video/mp4; codecs="avc1.4D401F, mp4a.40.2"') +
            (playingSession ? '&mode=' + playingSession.mode + '&mbps=' + playingSession.settings.mbps +
                '&audio=' + (playingSession.audioStreamIndex === null ? -1 : playingSession.audioStreamIndex) : '') +
            (video.error ? '&mediaError=' + video.error.code : '');
    }
    function show(name) {
        var ids = ['login', 'browser', 'details', 'player'], i;
        view = name;
        for (i = 0; i < ids.length; i += 1) { el(ids[i]).className = ids[i] === name ? '' : 'hidden'; }
        document.body.className = name === 'player' ? 'player-mode' : '';
        if (name === 'player') { window.scrollTo(0, 0); }
    }
    function isVisible(node) {
        while (node && node !== document) {
            if (node.className === 'hidden') { return false; }
            node = node.parentNode;
        }
        return true;
    }
    function focusables() {
        var nodes = document.querySelectorAll('button,input'), result = [], i;
        for (i = 0; i < nodes.length; i += 1) { if (!nodes[i].disabled && isVisible(nodes[i])) { result.push(nodes[i]); } }
        return result;
    }
    function focusFirst() {
        var nodes = focusables(); if (nodes.length) { nodes[0].focus(); }
    }
    function timeLabel(seconds) {
        if (!isFinite(seconds)) { seconds = 0; }
        seconds = Math.max(0, Math.floor(seconds || 0));
        var minutes = Math.floor(seconds / 60), rest = seconds % 60;
        return minutes + ':' + (rest < 10 ? '0' : '') + rest;
    }
    function handleError(error) {
        if (error.status === 401) {
            serial += 1; stopVideo(); api.logout(); busy = false;
            show('login'); focusFirst();
        }
        status(error.message, true);
    }
    function button(container, label, action) {
        var b = document.createElement('button'); b.type = 'button'; text(b, label); b.onclick = action;
        container.appendChild(b); return b;
    }
    function languageCode(stream) {
        var code = (stream.Language || '').toLowerCase();
        return ({ deu: 'de', ger: 'de', eng: 'en', fra: 'fr', fre: 'fr', spa: 'es', ita: 'it', jpn: 'ja' })[code] || code;
    }
    function audioLabel(stream) {
        var names = { de: 'Deutsch', en: 'Englisch', fr: 'Franzoesisch', es: 'Spanisch', it: 'Italienisch', ja: 'Japanisch' };
        var language = names[languageCode(stream)] || stream.Language || 'Unbekannte Sprache';
        return language + ' / ' + (stream.Codec || '?').toUpperCase() +
            (stream.Channels ? ' / ' + stream.Channels + ' Kanaele' : '') + (stream.Title ? ' / ' + stream.Title : '');
    }
    function currentTicks() {
        var seconds = isFinite(video.currentTime) ? video.currentTime : 0;
        return Math.round(seconds * 10000000) + (playingSession && playingSession.mode === 'mp4' ? playingSession.startTicks : 0);
    }
    function fitVideo() {
        if (view !== 'player') { return; }
        var top = video.getBoundingClientRect ? video.getBoundingClientRect().top : 100;
        var reserve = (el('player-controls').offsetHeight || 100) + (el('playback-position').offsetHeight || 28) + 30;
        video.style.height = Math.max(120, Math.min(540, (window.innerHeight || 720) - top - reserve)) + 'px';
    }
    function loadList() {
        var route = stack[stack.length - 1], ticket = ++serial;
        show('browser'); text(el('heading'), route.title); text(el('items'), ''); text(el('pagination'), '');
        text(el('page-info'), ''); busy = true; status('Medienliste wird geladen ...');
        function loaded(error, result) {
            if (ticket !== serial) { return; }
            busy = false;
            if (error) { handleError(error); focusFirst(); return; }
            var items = result && result.Items ? result.Items : [], i, total = result && result.TotalRecordCount;
            status(items.length ? 'Bibliothek geladen.' : 'Keine Eintraege vorhanden.');
            report('library_ok');
            function add(item) {
                button(el('items'), item.Name + (item.ProductionYear ? ' (' + item.ProductionYear + ')' : '') +
                    (item.UserData && item.UserData.Played ? ' [gesehen]' : '') +
                    (item.IsFolder || item.Type === 'CollectionFolder' ? '  >' : ''), function () {
                    if (busy) { return; }
                    if (item.IsFolder || item.Type === 'CollectionFolder' || item.Type === 'Series' || item.Type === 'Season' || item.Type === 'BoxSet') {
                        stack.push({ id: item.Id, title: item.Name, start: 0 }); loadList();
                    } else { details(item.Id); }
                });
            }
            for (i = 0; i < items.length; i += 1) { add(items[i]); }
            text(el('page-info'), 'Eintraege: ' + items.length + (typeof total === 'number' ? ' / ' + total : ''));
            if ((route.id || route.search) && route.start > 0) {
                button(el('pagination'), 'Vorherige Seite', function () { if (!busy) { route.start = Math.max(0, route.start - 18); loadList(); } });
            }
            if ((route.id || route.search) && (typeof total === 'number' ? route.start + items.length < total : items.length === 18)) {
                button(el('pagination'), 'Naechste Seite', function () { if (!busy) { route.start += 18; loadList(); } });
            }
            if (el('items').firstChild) { el('items').firstChild.focus(); } else { focusFirst(); }
        }
        if (route.id || route.search) { api.items(route.id, route.start, loaded, route.search); } else { api.views(loaded); }
    }
    function details(id) {
        var ticket = ++serial; busy = true; status('Details werden geladen ...');
        api.item(id, function (error, item) {
            if (ticket !== serial) { return; }
            busy = false;
            if (error) { handleError(error); return; }
            selected = item; show('details'); text(el('detail-title'), item.Name);
            text(el('overview'), (item.Overview || '').slice(0, 900)); text(el('sources'), '');
            text(el('technical'), 'Medientyp: ' + (item.MediaType || item.Type || 'unbekannt'));
            var sources = item.MediaSources || [], i;
            function add(source) {
                var streams = source.MediaStreams || [], codecs = [], audioTracks = [], j, audioPosition = 0;
                for (j = 0; j < streams.length; j += 1) {
                    if (streams[j].Type === 'Video') { codecs.push(streams[j].Codec + ' ' + (streams[j].Width || '?') + 'x' + (streams[j].Height || '?')); }
                    if (streams[j].Type === 'Audio' && typeof streams[j].Index === 'number' && streams[j].Index >= 0) { audioTracks.push(streams[j]); }
                }
                for (j = 0; j < audioTracks.length; j += 1) {
                    if (audioTracks[j].Index === source.DefaultAudioStreamIndex) { audioPosition = j; }
                }
                for (j = 0; j < audioTracks.length; j += 1) {
                    if (languageCode(audioTracks[j]) === preferences.language) { audioPosition = j; break; }
                }
                var panel = document.createElement('div'), label = document.createElement('p'), choices = document.createElement('div');
                panel.className = 'source-panel'; label.className = 'source-label'; choices.className = 'playback-options';
                text(label, 'Original: ' + (source.Container || '?').toUpperCase() + ' | ' + codecs.join(', ') +
                    (source.Bitrate ? ' | ' + (source.Bitrate / 1000000).toFixed(1) + ' Mbit/s' : ''));
                panel.appendChild(label); panel.appendChild(choices); el('sources').appendChild(panel);
                var audioButton, bitrateButton, modeButton;
                var settings = { sourceId: source.Id, mbps: preferences.mbps, mode: preferences.mode };
                function update() {
                    text(audioButton, audioTracks.length ? 'Tonspur: ' + audioLabel(audioTracks[audioPosition]) : 'Keine Tonspur');
                    text(bitrateButton, 'Zielbitrate: ' + settings.mbps + ' Mbit/s');
                    text(modeButton, 'Format: ' + (settings.mode === 'hls' ? 'HLS / MPEG-TS' : 'MP4 / HTTP'));
                }
                audioButton = button(choices, '', function () {
                    if (busy || !audioTracks.length) { return; }
                    audioPosition = (audioPosition + 1) % audioTracks.length;
                    preferences.language = languageCode(audioTracks[audioPosition]); update();
                });
                audioButton.setAttribute('data-option', 'audio'); audioButton.disabled = audioTracks.length < 2;
                bitrateButton = button(choices, '', function () {
                    if (busy) { return; }
                    settings.mbps = bitrateChoices[(bitrateChoices.indexOf(settings.mbps) + 1) % bitrateChoices.length];
                    preferences.mbps = settings.mbps; update();
                });
                bitrateButton.setAttribute('data-option', 'bitrate');
                modeButton = button(choices, '', function () {
                    if (busy) { return; }
                    settings.mode = settings.mode === 'hls' ? 'mp4' : 'hls'; preferences.mode = settings.mode; update();
                });
                modeButton.setAttribute('data-option', 'mode'); update();
                function start(ticks) {
                    play(source, ticks, { sourceId: source.Id, mbps: settings.mbps, mode: settings.mode,
                        audioStreamIndex: audioTracks.length ? audioTracks[audioPosition].Index : null,
                        audioLabel: audioTracks.length ? audioLabel(audioTracks[audioPosition]) : 'ohne Tonspur' });
                }
                var resumeTicks = item.UserData ? item.UserData.PlaybackPositionTicks || 0 : 0;
                if (resumeTicks > 100000000) {
                    button(panel, 'Fortsetzen bei ' + timeLabel(resumeTicks / 10000000), function () { start(resumeTicks); }).setAttribute('data-action', 'resume');
                }
                button(panel, 'Von Anfang abspielen', function () { start(0); }).setAttribute('data-action', 'play');
            }
            if (item.MediaType === 'Video' || item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video') {
                for (i = 0; i < sources.length; i += 1) { add(sources[i]); }
            }
            status(el('sources').firstChild ? 'Wiedergabetest bereit.' : 'Fuer diesen Eintrag ist noch keine Videoquelle verfuegbar.');
            focusFirst();
        });
    }
    function stopVideo() {
        clearInterval(progressTimer); progressTimer = null;
        if (playingSession && playingSession.started) { playbackEvent('Playing/Stopped'); }
        if (playingSession && !playingSession.encodingStopped) { api.stopEncoding(playingSession.playSessionId); }
        playingSession = null;
        video.pause(); video.removeAttribute('src'); video.load();
    }
    function playbackEvent(event) {
        if (!playingSession) { return; }
        var session = playingSession;
        var ticks = currentTicks();
        var data = {
            ItemId: session.itemId, MediaSourceId: session.sourceId, PlaySessionId: session.playSessionId,
            PositionTicks: ticks
        };
        if (event !== 'Playing/Stopped') {
            data.CanSeek = true; data.IsPaused = video.paused; data.IsMuted = video.muted;
            data.VolumeLevel = Math.round(video.volume * 100); data.PlayMethod = session.playMethod;
            data.AudioStreamIndex = session.audioStreamIndex; data.SubtitleStreamIndex = -1;
        } else if (session.failed) {
            data.Failed = true;
        }
        api.playbackEvent(event, data, function (error) {
            if (error && playingSession === session) { status('Video aktiv, aber Wiedergabefortschritt konnte nicht gespeichert werden.', true); }
        });
    }
    function play(source, startTicks, settings) {
        if (busy) { return; }
        playbackAttempt += 1;
        busy = true; status('Wiedergabesitzung wird vorbereitet ...');
        var ticket = ++serial, itemId = selected.Id;
        // HLS uses a full VOD timeline and native seeking; HTTP MP4 is restarted
        // at the requested offset and therefore has a relative video.currentTime.
        settings.startTicks = settings.mode === 'hls' ? 0 : startTicks;
        api.preparePlayback(itemId, settings, function (error, info) {
            if (ticket !== serial) { return; }
            busy = false;
            if (error) { handleError(error); return; }
            playingSession = { itemId: itemId, sourceId: source.Id, playSessionId: info.playSessionId,
                startTicks: startTicks, started: false, mode: settings.mode, playMethod: info.playMethod,
                audioStreamIndex: settings.audioStreamIndex, settings: settings, source: source,
                durationTicks: source.RunTimeTicks || selected.RunTimeTicks || 0 };
            show('player'); status('Jellyfin wandelt den Film fuer den TV um ...');
            text(el('playback-quality'), settings.audioLabel + ' → AAC Stereo | Ziel ' + settings.mbps +
                ' Mbit/s | H.264 bis 720p | ' + settings.mode.toUpperCase());
            text(el('playback-position'), '');
            fitVideo();
            video.src = info.url; video.load();
            try { video.play(); } catch (e) { status('Play konnte nicht gestartet werden.', true); }
            el('play-pause').focus();
        });
    }
    function back() {
        if (view === 'player') { stopVideo(); show('details'); focusFirst(); return; }
        if (view === 'details') { loadList(); return; }
        if (view === 'browser' && stack.length > 1) { stack.pop(); loadList(); }
    }
    function togglePlay() { if (video.paused) { video.play(); } else { video.pause(); } }
    function seek(delta) {
        if (playingSession && playingSession.mode === 'mp4') {
            var session = playingSession;
            var target = Math.max(0, currentTicks() + delta * 10000000);
            if (session.durationTicks) { target = Math.min(target, Math.max(0, session.durationTicks - 10000000)); }
            stopVideo(); play(session.source, target, session.settings); return;
        }
        try { video.currentTime = Math.max(0, Math.min(isFinite(video.duration) ? video.duration : video.currentTime + Math.abs(delta), video.currentTime + delta)); }
        catch (e) { status('Spulen wird fuer diese Quelle nicht unterstuetzt.', true); }
    }
    function finishLogin(error, manual) {
        busy = false; el('login-button').disabled = false; el('test-login').disabled = false;
        if (error) { status(error.message, true); el(manual ? 'password' : 'test-login').focus(); return; }
        report('login_ok'); stack = [{ id: '', title: 'Bibliotheken', start: 0 }]; loadList();
    }
    function loginTest() {
        if (busy) { return; }
        busy = true; el('login-button').disabled = true; el('test-login').disabled = true;
        status('Testkonto wird automatisch angemeldet ...');
        api.loginTest(finishLogin);
    }
    el('test-login').onclick = loginTest;
    el('login-form').onsubmit = function (event) {
        if (event && event.preventDefault) { event.preventDefault(); }
        if (busy) { return false; }
        if (!el('username').value) { status('Bitte Benutzernamen eingeben.', true); el('username').focus(); return false; }
        busy = true; el('login-button').disabled = true; el('test-login').disabled = true; status('Anmeldung ...');
        api.login(el('username').value, el('password').value, function (error) { finishLogin(error, true); });
        el('password').value = ''; return false;
    };
    el('back').onclick = back; el('detail-back').onclick = back; el('stop').onclick = back;
    el('home').onclick = function () { stack = [{ id: '', title: 'Bibliotheken', start: 0 }]; loadList(); };
    el('search-form').onsubmit = function (event) {
        if (event && event.preventDefault) { event.preventDefault(); }
        var query = el('search').value.replace(/^\s+|\s+$/g, '');
        if (!query) { status('Bitte Suchbegriff eingeben.'); return false; }
        var route = stack[stack.length - 1];
        stack.push({ id: route.id, title: 'Suche: ' + query, search: query, start: 0 });
        loadList(); return false;
    };
    el('logout').onclick = function () {
        serial += 1; stopVideo(); api.logout(); busy = false; stack = []; selected = null;
        el('username').value = ''; el('password').value = ''; text(el('items'), ''); text(el('sources'), '');
        show('login'); status('Abgemeldet.'); focusFirst();
    };
    el('play-pause').onclick = togglePlay;
    el('rewind').onclick = function () { seek(-30); };
    el('forward').onclick = function () { seek(30); };
    el('fullscreen').onclick = function () {
        try {
            if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); }
            else if (video.webkitRequestFullScreen) { video.webkitRequestFullScreen(); }
            else if (video.requestFullscreen) { video.requestFullscreen(); }
            else { status('Vollbild-API nicht verfuegbar.'); }
        } catch (e) { status('Vollbild nicht verfuegbar.'); }
    };
    video.addEventListener('loadedmetadata', function () {
        if (playingSession && playingSession.mode === 'hls' && playingSession.startTicks > 0) {
            try { video.currentTime = playingSession.startTicks / 10000000; }
            catch (e) { status('Fortsetzen nicht unterstuetzt; Wiedergabe beginnt am Anfang.', true); }
        }
    }, false);
    video.addEventListener('playing', function () {
        status('Wiedergabe gestartet.'); report('play_started');
        if (playingSession && !playingSession.started) {
            playingSession.started = true; playbackEvent('Playing');
            progressTimer = setInterval(function () {
                if (playingSession && !video.paused) { playbackEvent('Playing/Progress'); }
            }, 15000);
        }
    }, false);
    video.addEventListener('pause', function () {
        if (playingSession && playingSession.started) { playbackEvent('Playing/Progress'); }
    }, false);
    video.addEventListener('seeked', function () {
        if (playingSession && playingSession.started) { playbackEvent('Playing/Progress'); }
    }, false);
    video.addEventListener('timeupdate', function () {
        text(el('playback-position'), timeLabel(currentTicks() / 10000000) + ' / ' +
            timeLabel(playingSession && playingSession.durationTicks ? playingSession.durationTicks / 10000000 : video.duration));
    }, false);
    video.addEventListener('ended', function () { back(); status('Wiedergabe beendet.'); }, false);
    video.addEventListener('error', function () {
        if (view !== 'player') { return; }
        clearInterval(progressTimer); progressTimer = null;
        if (playingSession && !playingSession.encodingStopped) {
            api.stopEncoding(playingSession.playSessionId); playingSession.encodingStopped = true;
        }
        if (playingSession) { playingSession.failed = true; }
        status('MediaError ' + (video.error ? video.error.code : '?') + ' bei ' +
            (playingSession ? playingSession.mode.toUpperCase() : 'Video') +
            '. Zurueck zur Auswahl und das andere Format testen.', true);
        fitVideo();
        report('play_error');
    }, false);
    window.addEventListener('resize', fitVideo, false);
    function leavePage() {
        serial += 1; busy = false;
        if (playingSession) { stopVideo(); show('details'); }
    }
    window.addEventListener('pagehide', leavePage, false);
    window.addEventListener('beforeunload', leavePage, false);
    document.addEventListener('keydown', function (event) {
        var code = event.keyCode || event.which, node = document.activeElement, nodes, i, index = -1;
        if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
            if (code === 38 || code === 40) {
                nodes = focusables();
                for (i = 0; i < nodes.length; i += 1) { if (nodes[i] === node) { index = i; } }
                if (nodes[index + (code === 40 ? 1 : -1)]) { nodes[index + (code === 40 ? 1 : -1)].focus(); event.preventDefault(); }
            }
            return;
        }
        if (code === 37 || code === 38 || code === 39 || code === 40) {
            nodes = focusables();
            for (i = 0; i < nodes.length; i += 1) { if (nodes[i] === node) { index = i; } }
            index = Math.max(0, Math.min(nodes.length - 1, index + (code === 37 || code === 38 ? -1 : 1)));
            if (nodes[index]) { nodes[index].focus(); }
            report('remote_key'); event.preventDefault();
        } else if (code === 13 && node && node.tagName === 'BUTTON') {
            node.click(); report('remote_key'); event.preventDefault();
        } else if (code === 8 || code === 27 || code === 461 || code === 10009) {
            back(); event.preventDefault();
        } else if (view === 'player' && (code === 415 || code === 19 || code === 413 || code === 412 || code === 417)) {
            if (code === 415) { video.play(); } else if (code === 19) { video.pause(); }
            else if (code === 413) { back(); } else { seek(code === 412 ? -30 : 30); }
            event.preventDefault();
        }
    }, false);
    status('Eigener ES5-Client bereit.'); focusFirst();
    // Only fixed milestone names, never credentials, tokens, titles or media IDs.
    try {
        var hello = new XMLHttpRequest();
        hello.open('GET', '/viera/session', true);
        hello.onreadystatechange = function () {
            if (hello.readyState === 4 && hello.status === 200) {
                try { telemetryKey = JSON.parse(hello.responseText).key; report('client_ready'); } catch (e) {}
            }
        };
        hello.send(null);
    } catch (e) {}
    loginTest();
}());
