// acuxAPIVideo

(function(ADL){

var acuxAPIVideo = function() {

    function init() {
        var actor = JSON.parse(ADL.XAPIWrapper.lrs.actor); //actor is going to be the same for the whole activity (all videos in the page)

        var activityID;
        var returnURL;
        var XW = ADL.XAPIWrapper;  //short ref
        var player;
        var videoXObject;
        var vDuration;
        var played_segments = "";
        var currentSegment;
        var nProgress;         // normalized progress [0..1]
        var videoCompleted = false;
        var tuc = 10;         // timeUpdate count
        var seekStart = null;
        var pTracks;
        var volumeSliderActive;
        var wasPaused;
        var ignoreFirstSeek = false;
        var sendSynchronous = false;

        // statement-related vars
        var videoSessionId = null;
        var sentInitialized = false;

        function formatFloat(number) {
            if(number == null)
                return null;
            return +(parseFloat(number).toFixed(3));
        }

        function addCurrentSegment() {
            var arr;
            var currSegmentStr = formatFloat(currentSegment[0]) + "[.]" + formatFloat(currentSegment[1]);
            arr = (played_segments == "")? []:played_segments.split("[,]");
            arr.push(currSegmentStr);
            played_segments = arr.join("[,]");
        }

        function updateProgress() {
            var arr, arr2;
            var currSegmentStr = formatFloat(currentSegment[0]) + "[.]" + formatFloat(currentSegment[1]);
            //get played segments array
            arr = (played_segments == "")? []:played_segments.split("[,]");
            if (!player.paused()) {
                arr.push(currSegmentStr);
            }

            arr2 = [];
            arr.forEach(function(v,i) {
                arr2[i] = v.split("[.]");
                arr2[i][0] *= 1;
                arr2[i][1] *= 1;
            });

            //sort the array
            arr2.sort(function(a,b) { return a[0] - b[0];});

            //normalize the segments
            arr2.forEach(function(v,i) {
                if(i > 0) {
                    if(arr2[i][0] < arr2[i-1][1]) {     //overlapping segments: this segment's starting point is less than last segment's end point.
                        //console.log(arr2[i][0] + " < " + arr2[i-1][1] + " : " + arr2[i][0] +" = " +arr2[i-1][1] );
                        arr2[i][0] = arr2[i-1][1];
                        if(arr2[i][0] > arr2[i][1])
                            arr2[i][1] = arr2[i][0];
                    }
                }
            });

            //calculate progress_length
            var progress_length = 0;
            arr2.forEach(function(v,i) {
                if(v[1] > v[0])
                progress_length += v[1] - v[0]; 
            });

            var progress = 1 * (progress_length / player.duration()).toFixed(2);
            nProgress = progress;
            if (nProgress >= 0.99 && !videoCompleted) {
                videoCompleted = true;
                sendComplete();
            }
            return progress;
        }

        function getPlaybackSize() {
             var playbackSize = "";
             playbackSize += player.currentWidth() + "x" + player.currentHeight();
             return playbackSize;
        }

        function getCCInfo() {
            var res = {
                        ccEnabled: false,
                        ccLanguage: ''
            }
            for (var i = 0; i < pTracks.length; i++) {
                var track = pTracks[i];
                // If captions and subtitles are enabled mark track mode as "showing".
                if (track.kind === 'captions' || track.kind === 'subtitles') {
                    track.mode = 'showing';
                }
                // If it is showing then CC is enabled and determine the language
                if (track.mode ==='showing') {
                    res = {
                            ccEnabled: true,
                            ccLanguage: track.language
                    }
                } 
            }
            return res;
        }

        // xAPI-specific functions
        //
        function bareStatement() {
           var st =  new ADL.XAPIStatement();
           st.actor = actor;
           st.object = videoXObject;
           return st;
        }

        function sendInitialized() {
            videoSessionId = ADL.ruuid(); // Different from current xAPI Video Profile
            var quality = (player.videoHeight() < player.videoWidth())? player.videoHeight() : player.videoWidth();
            var mys = bareStatement();
            mys.id = videoSessionId;
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/initialized','initialized');
            var ccInfo = getCCInfo();
            mys.context = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/volume': player.muted() ? 0 : player.volume(),
                    'https://w3id.org/xapi/video/extensions/video-playback-size': getPlaybackSize(),
                    'https://w3id.org/xapi/video/extensions/user-agent': navigator.userAgent.toString(),
                    'https://w3id.org/xapi/video/extensions/cc-enabled': ccInfo.ccEnabled,
                    'https://w3id.org/xapi/video/extensions/cc-subtitle-lang': ccInfo.ccLanguage,
                    'https://w3id.org/xapi/video/extensions/screen-size': screen.width + "x" + screen.height,
                    'https://w3id.org/xapi/video/extensions/speed': player.playbackRate() + 'x',
                    'https://w3id.org/xapi/video/extensions/quality': quality,
                    'https://w3id.org/xapi/video/extensions/full-screen': player.isFullscreen()
                }
            }
            XW.sendStatement(mys);
            window.addEventListener("beforeunload", function (e) {
                sendSynchronous = true;
                // NONONO Calling player.pause() here does not trigger the 'pause' event and all the associated tasks
                // so we disconnect the event, and trigger the event handler (onPause) manually
                player.off('pause', onPause);
                onPause();
                sendTerminated();
            });
        }

        function sendPlayed() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('https://w3id.org/xapi/video/verbs/played', 'played');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': currentSegment[0],
                    'https://w3id.org/xapi/video/extensions/played-segments': played_segments
                }
            }
            XW.sendStatement(mys);
        }

        function sendPaused(seeking) {
            var ti =  seeking ? currentSegment[0] : formatFloat(player.currentTime());
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('https://w3id.org/xapi/video/verbs/paused', 'paused');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': ti,
                    'https://w3id.org/xapi/video/extensions/played-segments': played_segments,
                    'https://w3id.org/xapi/video/extensions/progress': nProgress
                }
            }
            XW.sendStatement(mys);
            saveState();

        }

        function sendSeeked (sFrom, sTo) {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('https://w3id.org/xapi/video/verbs/seeked', 'seeked');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time-to': sFrom,
                    'https://w3id.org/xapi/video/extensions/time-from': sTo
                }
            }
            XW.sendStatement(mys);
        }

        function sendVolumeChanged() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/interacted', 'interacted');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': formatFloat(player.currentTime()),
                    'https://w3id.org/xapi/video/extensions/volume': player.muted() ? 0 : player.volume()
                }
            }
            XW.sendStatement(mys);
        }

        function sendFullscreenChanged() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/interacted', 'interacted');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': formatFloat(player.currentTime()),
                    'https://w3id.org/xapi/video/extensions/full-screen': player.isFullscreen()
                }
            }
            XW.sendStatement(mys);
        }

        function sendRateChanged() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/interacted', 'interacted');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': formatFloat(player.currentTime()),
                    'https://w3id.org/xapi/video/extensions/speed': player.playbackRate() + 'x'
                }
            }
            XW.sendStatement(mys);
        }

        function sendComplete() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/completed', 'completed');
            mys.result = {
                success: true,
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': formatFloat(player.currentTime()),
                    'https://w3id.org/xapi/video/extensions/progress': nProgress,
                    'https://w3id.org/xapi/video/extensions/played-segments': played_segments
                }
            }
            XW.sendStatement(mys);
        }

        function sendTerminated() {
            var mys = bareStatement();
            mys.verb = new ADL.XAPIStatement.Verb('http://adlnet.gov/expapi/verbs/terminated', 'terminated');
            mys.result = {
                extensions: {
                    'https://w3id.org/xapi/video/extensions/session-id': videoSessionId,
                    'https://w3id.org/xapi/video/extensions/time': formatFloat(player.currentTime()),
                    'https://w3id.org/xapi/video/extensions/progress': nProgress,
                    'https://w3id.org/xapi/video/extensions/played-segments': played_segments
                }
            }
            saveState();
            /*
            XW.sendStatement(mys, function() {
                setTimeout( function() { location.href = returnURL || 'https://www.google.com'; }, 200);
            });
            */
            XW.sendStatement(mys);  //send synchronously
            location.href = returnURL;

        }

        function saveState() {
            // XAPIWrapper.prototype.sendState = function(activityid, agent, stateid, registration, stateval, matchHash, noneMatchHash, callback)
            var reg = XW.lrs.registration || null;
            var state = { played_segments: played_segments,
                          time: formatFloat(player.currentTime()),
                          progress: nProgress
            }
            jsonState = JSON.stringify(state);
            if (!sendSynchronous) {
                var callback = function(ev) {
                    console.log('State saved');
                }
            } else {
                callback = null;
            }
            XW.sendState(activityID, actor, 'VIDEOSTATE', reg, state, '*','*', callback );
        }

        function loadState(callback) {
            var reg = XW.lrs.registration;
            XW.getState(activityID, actor, 'VIDEOSTATE', reg, null, callback);
        }


        function  onReady(ev, hash) {
                player.one('loadedmetadata', onLoadedMetadata);
                player.on('play', onPlay);
                player.on('timeupdate', onTimeUpdate);
                player.on('pause', onPause);
                player.on('ended', onEnded);
                // NO NO NO player.on('seeked', onSeeked); do not wire-up seeked until we've loaded state.
                player.on('seeked', onSeeked); 
                // player.on('seeking', this.onSeeking.bind(this));
                player.on('volumechange', onVolumeChange);
                player.on('ratechange', onRateChange);
                player.on('fullscreenchange', onFullscreenChange);
                player.controlBar.volumePanel.volumeControl.on('slideractive', onSlideractive);
                player.controlBar.volumePanel.volumeControl.on('sliderinactive', onSliderinactive);
                //console.log('video player ready');
                // this.trigger('videoplayer-ready', this);
                pTracks = player.textTracks();
                // load the state info
                loadState(onStateLoaded);
                //sendInitialized();
            }

            function onStateLoaded(ev) {
                var state = JSON.parse(ev.response);
                console.log('State loaded', state);
                if (state) {
                    if (state.played_segments) {
                        played_segments = state.played_segments;
                    }
                    if (state.progress) {
                        nProgress = state.progress;
                    }
                    if (state.time) {
                        // let's not track the initial seek
                        ignoreFirstSeek = true;
                        player.currentTime(state.time);
                        currentSegment = [state.time, state.time];
                        //player.play();
                    }
                }
                sendInitialized();
            }

            function onLoadedMetadata(ev) {
                vDuration = this.duration();
                //console.log('duration: ' + vDuration);
            }

            function onPlay() {
                // console.log('play...');
                var t = player.currentTime();
                currentSegment = [t, t];
                sendPlayed();
            }

            function onTimeUpdate() {
                // console.log('TIMEUPDATE happened...');
                if (!player.paused() && currentSegment) {
                    currentSegment[1] = player.currentTime();
                }
                tuc--;
                if (tuc==0) {
                    tuc = 10;
                    updateProgress();
                }
            }

            function onPause() {
                var seeking = player.seeking();
                if (seeking) {
                    //console.log('PAUSE because of SEEKING at ' + player.currentTime() + ' currentSegment[1]= '+ currentSegment[1]);
                    // skipNextPlay = true;
                    seekStart = currentSegment[1];
                } else {
                    //console.log('PAUSE because of USER action at ',  player.currentTime());
                }
                addCurrentSegment();
                updateProgress();
                sendPaused(seeking);
                // console.log(played_segments);
                //console.log(nProgress);
            }

            function onEnded() {
                //console.log('ON ENDED happened');
                if (videoCompleted) { return};
                updateProgress();
            }

            function onSeeked() {
                // HERE - use currentSegment[1] to get the seeked-from time
                // console.log('seeked...from ' + currentSegment[1] + ' to ' +  player.currentTime());
                if (ignoreFirstSeek) {
                    ignoreFirstSeek = false;
                    return;
                };
                sendSeeked(seekStart, formatFloat(player.currentTime()));
            }

            function onSeeking() {
                //console.log('seeking...', player.currentTime(), player.paused());
            }

            function onSlideractive() {
                volumeSliderActive = true;
            }

            function onSliderinactive() {
                volumeSliderActive = false;
                sendVolumeChanged();
            }

            function onVolumeChange() {
                if (!volumeSliderActive) {
                    sendVolumeChanged();
                }
            }

            function onRateChange() {
                sendRateChanged();
            }

            function onFullscreenChange() {
                sendFullscreenChanged();
            }

            function pauseUnpause() {
                // this is unfinished
                if ( wasPaused == 'undefined') {
                    wasPaused = player.paused()
                }
                if (!player.paused()) {
                    player.pause();
                }
                if (wasPaused) {
                    player.play();
                }
            }

            function terminate(returnUrl) {
                returnURL = returnURL || 'https://www.google.com';
                sendSynchronous = true;
                // this function will be called from the outside, that's why it's not called 'onTerminate'
                player.pause();
                //setTimeout(sendTerminated, 250);
                sendTerminated();
            }


            function initialize(videoId, activityIdBase, options, name, description) {

                //console.log('Initializing acuxAPIVideo');
                var activityIdBase = activityIdBase[activityIdBase.length -1] == '/' ? activityIdBase : activityIdBase + '/';
                var name = name || '';
                var description = description || '';
                activityID = activityIdBase + videoId;
                videoXObject = new ADL.XAPIStatement.Activity(activityID);
                videoXObject.definition = {type: 'https://w3id.org/xapi/video/activity-type/video'};
                if (typeof(name) == 'object') {
                    videoXObject.definition.name = name;
                } else {
                    videoXObject.definition.name = { 'en-US': name};
                }
                if (typeof(description) == 'object') {
                    videoXObject.definition.description = description;
                } else {
                    videoXObject.definition.description = { 'en-US': description};
                }

                var options = options || {
                    controls: true,
                    autoplay: false,
                    preload: 'auto',
                    fluid: false,
                    playbackRates: [ 0.75, 1, 1.25, 1.5, 2, 4]
                };
                player = videojs(videoId, options); // .ready( this.onReady.bind(this));
                //console.log(player);
                //player.on('ready', this.onReady.bind(this));
                player.on('ready', onReady);

            }

        return {
            initialize: initialize,
            terminate: terminate
        }

    }  // closes instance function

   return {
        getInstance: function () {
            var instance = init();
            return instance;
        }
   };


} //closes acuxAPIVideo

ADL.acuxAPIVideo = acuxAPIVideo();
}(window.ADL = window.ADL || {}));
