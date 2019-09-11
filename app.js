document.addEventListener("DOMContentLoaded", function () {

  //
  // url parser and generator
  //

	function getCurrentDomain() {
		let dirs = window.location.href.split("/");
		let s = dirs[0];
		for (let i=1; i<dirs.length-1; i++) {
			s += "/" + dirs[i];
		}
		return s;
	}

  const url = getCurrentDomain() + "/room.html";
  const roomurlelem = document.querySelector("#room-url");

  function parseQueryString(query) {
    let obj = {};
    query.split("&").forEach(function (s) {
      let kv = s.split("=");
      obj[kv[0]] = kv[1];
    });
    return obj;
  }

  function generateRoomURL(id, pass) {
    return url + "?id=" + id + "&pass=" + pass;
  }

  function displayRoomURL(id, pass) {
    roomurlelem.innerText = generateRoomURL(id, pass);
  }

  function getQuery() {
    return parseQueryString(document.location.search.substring(1));
  }

  //
  // screen api
  //

  const screenselem = document.querySelector("#screens");
  const qualityelem = document.querySelector("#quality");
  const fpselem = document.querySelector("#fps");

  function getScreen() {
    const options = {
      low: {width: {max: 1024}, height: {max: 576}},
      mid: {width: {max: 1280}, height: {max: 720}},
      high: {width: {max: 1920}, height: {max: 1080}},
    };
    const quality = qualityelem.options[qualityelem.selectedIndex].value;
    const fps = parseInt(fpselem.options[fpselem.selectedIndex].value);
    const videoopt = options[quality];
    videoopt.frameRate = fps;

    const constraints = {video: videoopt, audio: false};
    return navigator.mediaDevices.getDisplayMedia(constraints, function (scr) {
      let track = scr.getTracks()[0];
      if ('contentHint' in track) {
        track.contentHint = 'text';
      }
      return scr;
    });
  }
  function playScreen(videoElem, screen) {
    videoElem.controls = true;
    videoElem.autoplay = true;
    videoElem.srcObject = screen;
  }
  function addScreen(id, screen) {
    let video = document.createElement("video");
    playScreen(video, screen);
    screenselem.appendChild(video);
    screens[id] = video;
    return video;
  }
  function removeScreen(id) {
    if (id in screens) {
      let tracks = screens[id].srcObject.getTracks();
      tracks.forEach(track => track.stop());
      screenselem.removeChild(screens[id]);
      delete screens[id];
    }
  }

  //
  // message
  //

  let messageelem = document.querySelector("#messages");

  function notifyMessage(s) {
    let msg = document.createElement("p");
    msg.innerText = s;
    messageelem.appendChild(msg);
    statustimeout = setTimeout(function() {
      messageelem.removeChild(msg);
    }, 5000);
  }

  //
  // peer management
  //

  let connections = {};
  let screens = {};
  let screen = null;
  let pass = "";
  let dataqueue = {};

  function propagateToConnections(id) {
    Object.values(connections).forEach(function (c) {
      if (c.authorized) {
        c.send({type: "another-peer", peer: id});
      }
    });
  }

  function shareScreenToConnections(peer, screen) {
    Object.values(connections).forEach(function (c) {
      if (c.authorized) {
        peer.call(c.peer, screen);
      }
    });
  }

  function shareScreenIfStarting(peer, id, screen) {
    if (screen !== null && screen.active) {
      if (connections[id].authorized) {
        peer.call(id, screen);
      }
    }
  }

  function stopSharing(data) {
    if (connections[data.peer].authorized) {
      removeScreen(data.peer);
      if (data.type === "close") {
        // connections[data.peer].close();
        delete connections[data.peer];
      }
    }
  }
  
  function readData(peer, c, data) {
    console.log(data);

    // authorize
    if (data.type === "authorize") {
      if (c.peer in connections && connections[c.peer].authorized) return;
      if (data.pass === pass) {
        // c.send({type: "authorize", pass: pass});
        connectDataChannel(peer, c.peer, pass);
        connections[c.peer].authorized = true;
        notifyMessage("ID:" + c.peer + "は認証に成功しました");
        propagateToConnections(c.peer);
        shareScreenIfStarting(peer, c.peer, screen);
        if (c.peer in dataqueue) {
          dataqueue[c.peer].forEach(data => {
            readData(peer, c, data);
          });
          delete dataqueue[c.peer];
        }
      } else {
        connections[c.peer].send({type: "failed-authorize"});
        notifyMessage("ID:" + c.peer + "は認証に失敗しました");
      }
    } else if (data.type === "failed-authorize") {
      alert("接続先の認証に失敗しました");
    }

    // queueing when not authorized
    if (!(c.peer in connections) || !connections[c.peer].authorized) {
      if (!(c.peer in dataqueue)) dataqueue[c.peer] = [];
      dataqueue[c.peer].push(data);
      return;
    }

    console.log("Authorized: " + JSON.stringify(data));
    if (data.type === "stop-sharing" || data.type === "close") {
      stopSharing(data);
    } else if (data.type === "another-peer") {
      connectDataChannel(peer, data.peer, pass);
    }
  }

  function connectDataChannel(peer, id, pass) {
    if (peer.id === id) return;
    if (id in connections) {
      if (connections[id].authorized) {
        return;
      }
    }
    let c = peer.connect(id, {reliable: true});
    connections[id] = c;
    c.authorized = false;
    c.on('open', function () {
      c.on('data', function (data) {
        readData(peer, c, data);
      });
      c.send({type: "authorize", pass: pass});
    });
  }

  function createUserPeer() {
    let peer = new Peer({});

    peer.on('call', function(call) {
      call.answer(null);
      call.on('stream', function (screen) {
        notifyMessage("ID:" + call.peer + "による画面共有");
        if (connections[call.peer].authorized) {
          addScreen(call.peer, screen);
        }
      });
    });

    peer.on('open', function (id) {
      notifyMessage("接続を待機しています");
    });

    peer.on('connection', function (c) {
      c.on('data', function (data) {
        readData(peer, c, data);
      });
    });

    peer.on('error', function (err) {
      if (err.toString().search("addIceCandidate") === -1) {
        notifyMessage("エラーが発生しました: " + err);
      }
      console.log(err);
    });

    return peer;
  }

  //
  // sharing events
  //

  let startSharingElem = document.querySelector("#start-sharing");
  let stopElem = document.querySelector("#stop-sharing");

  let peer = createUserPeer();
  peer.on('open', function () {
    let query = getQuery();
    if ('pass' in query) {
      pass = query.pass;
    } else {
      pass = "";
    }
    if ('id' in query) {
      connectDataChannel(peer, query.id, pass);
    }
    displayRoomURL(peer.id, pass);
  });

  document.querySelector("#copy-url").addEventListener("click", function (e) {
    let range = document.createRange();
    range.selectNodeContents(roomurlelem);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    if (document.execCommand('copy')) {
      notifyMessage("コピーしました");
    } else {
      notifyMessage("コピーに失敗しました");
    }
    window.getSelection().removeAllRanges();
  });

  startSharingElem.addEventListener("click", function (e) {
    if (screen === null) {
      getScreen().then(function (scr) {
        screen = scr;
        addScreen("own", screen);
        shareScreenToConnections(peer, screen);
      });
      return;
    }

    if (!screen.active) {
      getScreen().then(function (scr) {
        screen = scr;
        addScreen("own", screen);
        shareScreenToConnections(peer, screen);
      });
      return;
    }

    alert("既に画面共有がされています");
  });

  stopElem.addEventListener("click", function (e) {
    Object.values(connections).forEach(function (c) {
      c.send({type: "stop-sharing", peer: peer.id});
    });
    removeScreen("own");
    screen = null;
  });
  window.addEventListener("beforeunload", function (e) {
    Object.values(connections).forEach(function (c) {
      c.send({type: "close", peer: peer.id});
    });
    e.preventDefault();
    e.returnValue = '';
    removeScreen("own");
  });
});
