"use strict";

var $            = require("jquery"),
    renderer     = require("./renderer.js"),
    Cameras      = require("../../../../superconductorjs/src/Camera.js"),
    ui           = require("./ui.js"),
    interaction  = require("./interaction.js");

// global["debugjs"] = require("debug");


function init(canvas) {
    var gl = renderer.init(canvas);

    var programs = renderer.loadProgram(gl);
    var buffers = renderer.createBuffers(gl);

    var camera = new Cameras.Camera2d({
        left: -0.15,
        right: 5,
        bottom: 5, // (5 * (1 / (700/700))) - 0.15,
        top: -0.15 // - 0.15
    });
    renderer.setCamera(gl, programs, camera);
    interaction.setupDrag($(".sim-container"), camera)
        .merge(interaction.setupScroll($(".sim-container"), camera))
        .subscribe(function(newCamera) {
            renderer.setCamera(gl, programs, newCamera);
            renderer.render(gl, programs, buffers);
        });


    var glBufferStoreSize = 0;

    var socket = io.connect("http://localhost", {reconnection: false, transports: ['websocket']});

    var lastHandshake = new Date().getTime();
    socket.on("vbo_update", function (data, handshake) {
        var now = new Date().getTime();
        console.log("got VBO update message", now - lastHandshake, "ms");
        lastHandshake = now;


        //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data?redirectlocale=en-US&redirectslug=DOM%2FXMLHttpRequest%2FSending_and_Receiving_Binary_Data
        var oReq = new XMLHttpRequest();
        oReq.open("GET", "http://localhost:1337/vbo", true);
        oReq.responseType = "arraybuffer";
        oReq.onload = function (oEvent) {
            var gotCompressedVBO = new Date().getTime();
            console.log("got VBO data", gotCompressedVBO - now, "ms");

            handshake(now - lastHandshake);

            var arrayBuffer = oReq.response; // Note: not oReq.responseText
            //var byteArray = new Uint8Array(arrayBuffer);
            var trimmedArray = new Uint8Array(
                arrayBuffer,
                0,
                data.numVertices * (3 * Float32Array.BYTES_PER_ELEMENT + 4 * Uint8Array.BYTES_PER_ELEMENT));

            renderer.loadBuffer(gl, trimmedArray, data.numVertices <= glBufferStoreSize);
            renderer.render(gl, data.numVertices);
            glBufferStoreSize = Math.max(glBufferStoreSize, data.numVertices);
        };
        oReq.send(null);
    });

    socket.on("error", function(reason) {
        ui.error("Connection error (reason: " + reason + ")");
    });
    socket.on("disconnect", function(reason) {
        ui.error("Disconnected (reason: " + reason + ")");
    });
}


window.addEventListener("load", function(){
    init($("#simulation")[0]);
});
