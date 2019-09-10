document.addEventListener("DOMContentLoaded", function () {
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
  const screenselem = document.querySelector("#screens");
  const qualityelem = document.querySelector("#quality");
  const fpselem = document.querySelector("#fps");

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

  let idelem = document.querySelector("#peer-id");
  let statuselem = document.querySelector("#status-menu");

  function updateStatus(s) {
    let msg = document.createElement("p");
    msg.innerText = s;
    statuselem.appendChild(msg);
    statustimeout = setTimeout(function() {
      statuselem.removeChild(msg);
    }, 5000);
  }

  let connections = {};
  let screens = {};
  let calls = {};
  let screen = null;
  let pass = "";

  function propagateToConnections(id) {
    Object.values(connections).forEach(function (anotherconn) {
      if (anotherconn.authorized) {
        anotherconn.send({type: "another-peer", peer: id});
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
      peer.call(id, screen);
    }
  }

  function stopSharing(data) {
    removeScreen(data.peer);
    if (data.type === "close") {
      // connections[data.peer].close();
      delete connections[data.peer];
    }
  }

  function connectDataPeer(peer, id, pass) {
    if (peer.id === id) return;
    if (id in connections) return;
    let c = peer.connect(id, {reliable: false});
    connections[id] = c;
    c.on('open', function (c) {
      connections[id].send({type: "authorize", pass: pass});
    });
    c.on('data', function (data) {
      if (data.type === "authorize") {
        if (data.pass === pass) {
          c.authorized = true;
          shareScreenIfStarting(peer, c.peer, screen);
          updateStatus("ID:" + c.peer + "は認証に成功しました");
        } else {
          updateStatus("ID:" + c.peer + "は認証に失敗しました");
        }
      } else if (data.type === "stop-sharing" || data.type === "close") {
        stopSharing(data);
      } else if (data.type === "another-peer") {
        if (c.authorized) {
          connectDataPeer(peer, data.peer, pass);
        }
      } else if (data.type === "name") {
        connections[id].name = data.name;
      }
    });
  }

  function createUserPeer() {
    let peer = new Peer({});
    peer.on('open', function (id) {
      updateStatus("接続を待機しています");
    });
    peer.on('connection', function (c) {
      updateStatus("ID:" + c.peer + "が接続しました");
      Object.values(connections).forEach(function (anotherconn) {
        c.send({type: "another-peer", peer: anotherconn.peer});
      });

      connections[c.peer] = c;
      connections[c.peer].authorized = false;
      propagateToConnections(c.peer);
      c.on('data', function (data) {
        if (data.type === "authorize") {
          if (data.pass === pass) {
            connections[c.peer].authorized = true;
            connections[c.peer].send({type: "authorize", pass: pass});
            shareScreenIfStarting(peer, c.peer, screen);
            updateStatus("ID:" + c.peer + "は認証に成功しました");
          } else {
            updateStatus("ID:" + c.peer + "は認証に失敗しました");
          }
        } else if (data.type === "stop-sharing" || data.type === "close") {
          stopSharing(data);
        }
      });
    });

    peer.on('disconnected', function () {
      updateStatus("Disconnected");
    });
    peer.on('close', function () {
      updateStatus("Closed");
    });
    peer.on('error', function (err) {
      updateStatus("エラーが発生しました: " + err);
      console.log(err);
    });

    peer.on('call', function(call) {
      call.answer();
      call.on('stream', function (screen) {
        if (connections[call.peer].authorized) {
          addScreen(call.peer, screen);
        }
      });
    });

    return peer;
  }

  let sendIdElem = document.querySelector("#send-id");
  let sendButtonElem = document.querySelector("#send-button");
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
      connectDataPeer(peer, query.id, pass);
    }
    displayRoomURL(peer.id, pass);
  });

  document.querySelector("#copy-url").addEventListener("click", function (e) {
    let range = document.createRange();
    range.selectNodeContents(roomurlelem);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    if (document.execCommand('copy')) {
      updateStatus("コピーしました");
    } else {
      updateStatus("コピーに失敗しました");
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
