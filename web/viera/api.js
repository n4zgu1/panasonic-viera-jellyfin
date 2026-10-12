/* ES5-only adapter. Browser tokens stay in memory; fixed test credentials live on the Mac proxy. */
(function (root) {
    'use strict';
    function VieraApi(XHR, timers) {
        var token = '', userId = '', generation = 0;
        var deviceId = 'viera-es5-' + String(new Date().getTime());
        timers = timers || root;
        function request(method, path, data, callback) {
            var xhr = new XHR(), finished = false, timer, epoch = generation;
            function finish(error, result) {
                if (finished) { return; }
                finished = true;
                timers.clearTimeout(timer);
                if (epoch === generation) { callback(error, result); }
            }
            try {
                xhr.open(method, path, true);
                xhr.setRequestHeader('Authorization', 'MediaBrowser Client="Viera Jellyfin", Device="Panasonic Viera", DeviceId="' + deviceId + '", Version="0.4.0"' +
                    (token ? ', Token="' + token.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : ''));
                if (data !== null) { xhr.setRequestHeader('Content-Type', 'application/json'); }
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4 || finished) { return; }
                    if (xhr.status < 200 || xhr.status >= 300) {
                        finish({ status: xhr.status, message: xhr.status === 401 ? 'Anmeldung abgelehnt oder Sitzung abgelaufen.' : 'Serverantwort HTTP ' + xhr.status });
                        return;
                    }
                    var result;
                    try { result = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
                    catch (e) { finish({ message: 'Ungueltige JSON-Antwort.' }); return; }
                    finish(null, result);
                };
                xhr.onerror = function () { finish({ message: 'Netzwerkfehler. Mac und Tailscale pruefen.' }); };
                timer = timers.setTimeout(function () {
                    finish({ message: 'Zeitlimit: Server antwortet nicht.' });
                    xhr.abort();
                }, 20000);
                xhr.send(data === null ? null : JSON.stringify(data));
            } catch (e) { finish({ message: 'HTTP-Anfrage konnte nicht gestartet werden.' }); }
        }
        function loginRequest(path, data, callback) {
            generation += 1; token = ''; userId = '';
            request('POST', path, data, function (error, result) {
                if (!error && (!result || !result.AccessToken || !result.User || !result.User.Id)) {
                    error = { message: 'Anmeldeantwort unvollstaendig.' };
                }
                if (!error) { token = result.AccessToken; userId = result.User.Id; }
                callback(error);
            });
        }
        this.login = function (name, password, callback) {
            loginRequest('/Users/AuthenticateByName', { Username: name, Pw: password }, callback);
        };
        this.loginTest = function (callback) {
            loginRequest('/viera/test-login', null, callback);
        };
        this.logout = function () {
            if (token) { request('POST', '/Sessions/Logout', null, function () {}); }
            generation += 1; token = ''; userId = '';
        };
        this.views = function (callback) {
            request('GET', '/Users/' + encodeURIComponent(userId) + '/Views', null, callback);
        };
        this.items = function (parent, start, callback, search) {
            request('GET', '/Users/' + encodeURIComponent(userId) + '/Items?' + (parent ? 'ParentId=' + encodeURIComponent(parent) + '&' : '') +
                'StartIndex=' + start + '&Limit=18&SortBy=SortName&SortOrder=Ascending&Recursive=' + (search ? 'true' : 'false') +
                (search ? '&SearchTerm=' + encodeURIComponent(search) + '&IncludeItemTypes=Movie,Episode,Video,Series' : ''), null, callback);
        };
        this.item = function (id, callback) {
            request('GET', '/Users/' + encodeURIComponent(userId) + '/Items/' + encodeURIComponent(id), null, callback);
        };
        this.videoUrl = function (itemId, mediaSourceId) {
            if (!token) { throw new Error('Nicht angemeldet'); }
            return '/Videos/' + encodeURIComponent(itemId) + '/stream?Static=true&MediaSourceId=' +
                encodeURIComponent(mediaSourceId) + '&ApiKey=' + encodeURIComponent(token);
        };
        this.playbackInfo = function (itemId, callback) {
            request('GET', '/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo?UserId=' + encodeURIComponent(userId), null, callback);
        };
        this.preparePlayback = function (itemId, settings, callback) {
            var mbps = Number(settings.mbps), mode = settings.mode, audio = settings.audioStreamIndex;
            if ([1, 2, 4, 6, 8, 12].indexOf(mbps) === -1 || ['hls', 'mp4'].indexOf(mode) === -1 ||
                !settings.sourceId || (audio !== null && (typeof audio !== 'number' || audio < 0 || Math.floor(audio) !== audio))) {
                callback({ message: 'Ungueltige Wiedergabe-Einstellungen.' }); return;
            }
            function condition(property, value, comparison) {
                return { Condition: comparison || 'LessThanEqual', Property: property, Value: String(value), IsRequired: true };
            }
            var profile = {
                Name: 'Viera TX-42ASW504 H264 AAC conservative', MaxStreamingBitrate: mbps * 1000000,
                DirectPlayProfiles: [],
                TranscodingProfiles: [{
                    Container: mode === 'hls' ? 'ts' : 'mp4', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac',
                    Protocol: mode === 'hls' ? 'hls' : 'http', Context: 'Streaming', MaxAudioChannels: '2',
                    MinSegments: 2, SegmentLength: 6, EnableSubtitlesInManifest: false, EnableAudioVbrEncoding: false
                }],
                CodecProfiles: [
                    { Type: 'Video', Codec: 'h264', Conditions: [
                        condition('Width', 1280), condition('Height', 720), condition('VideoBitDepth', 8),
                        condition('VideoFramerate', 30), condition('VideoLevel', 31),
                        condition('VideoProfile', 'main', 'Equals'), condition('VideoRangeType', 'SDR', 'Equals')
                    ] },
                    { Type: 'VideoAudio', Codec: 'aac', Conditions: [
                        condition('AudioChannels', 2), condition('AudioBitrate', 192000), condition('AudioSampleRate', 48000)
                    ] }
                ], SubtitleProfiles: []
            };
            var data = {
                UserId: userId, MediaSourceId: settings.sourceId, MaxAudioChannels: 2,
                MaxStreamingBitrate: mbps * 1000000, StartTimeTicks: settings.startTicks || 0,
                AudioStreamIndex: audio, SubtitleStreamIndex: -1,
                EnableDirectPlay: false, EnableDirectStream: false, EnableTranscoding: true,
                AllowVideoStreamCopy: false, AllowAudioStreamCopy: false, AutoOpenLiveStream: false,
                DeviceProfile: profile
            };
            request('POST', '/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', data, function (error, info) {
                if (error) { callback(error); return; }
                var sources = info && info.MediaSources ? info.MediaSources : [], source = null, i;
                for (i = 0; i < sources.length; i += 1) {
                    if (sources[i].Id === settings.sourceId) { source = sources[i]; break; }
                }
                if (!source || !source.TranscodingUrl || !source.SupportsTranscoding || !info.PlaySessionId) {
                    callback({ message: 'Jellyfin bietet keinen passenden H.264/AAC-Stream an. Transcoding-Berechtigung pruefen.' }); return;
                }
                var url = source.TranscodingUrl;
                // Only same-origin video routes. No credentials or absolute upstream URLs in logs.
                if (url.charAt(0) !== '/' && !/^https?:\/\//i.test(url)) { url = '/' + url; }
                url = url.replace(/^https?:\/\/[^/]+/i, '');
                if (!/^\/videos\/[^/?]+\//i.test(url) || url.indexOf('\\') !== -1 || /[\r\n]/.test(url)) {
                    callback({ message: 'Unerwartete Streaming-Adresse vom Server.' }); return;
                }
                // This server rejects legacy api_key spelling; normalize only this auth parameter.
                url = url.replace(/([?&])(?:api_key|apikey)=/ig, '$1ApiKey=');
                if (!/[?&]ApiKey=/.test(url)) { url += (url.indexOf('?') === -1 ? '?' : '&') + 'ApiKey=' + encodeURIComponent(token); }
                callback(null, { url: url, playSessionId: info.PlaySessionId, sourceId: source.Id,
                    mode: mode, mime: mode === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4',
                    playMethod: 'Transcode', audioStreamIndex: audio, mbps: mbps,
                    startTicks: settings.startTicks || 0 });
            });
        };
        this.stopEncoding = function (playSessionId, callback) {
            if (!playSessionId) { if (callback) { callback(null); } return; }
            request('DELETE', '/Videos/ActiveEncodings?DeviceId=' + encodeURIComponent(deviceId) +
                '&PlaySessionId=' + encodeURIComponent(playSessionId), null, callback || function () {});
        };
        this.playbackEvent = function (event, data, callback) {
            if (['Playing', 'Playing/Progress', 'Playing/Stopped'].indexOf(event) === -1) { throw new Error('Unbekanntes Ereignis'); }
            request('POST', '/Sessions/' + event, data, callback || function () {});
        };
    }
    root.VieraApi = VieraApi;
}(this));
