document.addEventListener("DOMContentLoaded", function () {
  const url = "C:/Users/shsno/github/screen-room/index.html";
  const roomurlelem = document.querySelector("#room-url");
  const screenselem = document.querySelector("#screens");

  function generateRoomURL(id) {
    return url + "?" + id;
  }

  function displayRoomURL(id) {
    roomurlelem.innerText = generateRoomURL(id);
  }

  function getIdFromURL() {
    return document.location.search.substring(1);
  }

  function getScreen() {
    const constraints = {
      video: {
        width: {
          max: 1280
        },
        height: {
          max: 720
        },
        frameRate: 15
      },
      audio: false
    }
    return navigator.mediaDevices.getDisplayMedia(constraints, function (scr) {
      let track = MediaStream.getTracks()[0];
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
      screenselem.removeChild(screens[id]);
      delete screens[id];
    }
  }

  let idelem = document.querySelector("#peer-id");
  let statuselem = document.querySelector("#status-menu");

  function updateIdElem(id) {
    // idelem.innerText = id;
  };

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

  function propagateToConnections(id) {
    Object.values(connections).forEach(function (anotherconn) {
      anotherconn.send({type: "another-peer", peer: id});
    });
  }

  function shareScreenToConnections(peer, screen) {
    Object.values(connections).forEach(function (c) {
      peer.call(c.peer, screen);
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

  function connectDataPeer(peer, id) {
    if (peer.id === id) return;
    if (id in connections) return;
    connections[id] = peer.connect(id, {reliable: false});
    connections[id].on('data', function (data) {
      if (data.type === "stop-sharing" || data.type === "close") {
        stopSharing(data);
      } else if (data.type === "another-peer") {
        connectDataPeer(peer, data.peer);
        shareScreenIfStarting(peer, data.peer, screen);
      } else if (data.type === "name") {
        connections[id].name = data.name;
      }
    });
  }

  function createUserPeer() {
    let peer = new Peer({});
    peer.on('open', function (id) {
      displayRoomURL(peer.id);
      updateIdElem(peer.id);
      updateStatus("接続を待機しています");
    });
    peer.on('connection', function (c) {
      updateStatus("ID:" + c.peer + "が接続しました");
      Object.values(connections).forEach(function (anotherconn) {
        c.send({type: "another-peer", peer: anotherconn.peer});
      });
      shareScreenIfStarting(peer, c.peer, screen);

      c.on('data', function (data) {
        if (data.type === "stop-sharing" || data.type === "close") {
          stopSharing(data);
        }
      });

      connections[c.peer] = c;
      propagateToConnections(c.peer);
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
        addScreen(call.peer, screen);
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
    let idfromurl = getIdFromURL();
    if (idfromurl !== "") {
      connectDataPeer(peer, idfromurl);
    }
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
