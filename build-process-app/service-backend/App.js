const express = require("express");
const http = require("http");
const amqp = require("amqplib/callback_api");
const index = require("./routes/index.js");

const port = process.env.PORT || 4001;
const app = express();
app.use(express.static("dist"));
const server = http.createServer(app);

//Global variables where are stored informations about the messaging server and the channel
var message = [];
var percentage = 0;
const server_path = "amqp://localhost";

//Pass the Cross Origin error, do not deploy
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
  },
});

main();


//Calling main function in socketio-connection.js
function main(){
  var action = {};
  var activeStep = 0;
  var newStepStages = [];
  var stages = [];
  var exchange = 'mars';
  key = 'sequencer.report.process.all';
  key2 = 'sequencer.report.process.status';
  key3 = 'hmi.process.reset';
  //Connexion to rabbitMQ server
  try {
    //Creating connection with rabbitMQ server
    amqp.connect(server_path, function(error0, connection) {
      if (error0) {
        throw error0;
      }
      connection.createChannel(function(error1, channel) {
        if (error1) {
          throw error1;
        }
        channel.assertExchange(exchange, 'topic', {
          durable: false
        });
        channel.assertQueue('', { exclusive: true
        }, function(error2, q) {
          if (error2) {
            throw error2;
          }
          console.log(' [*] Waiting for logs. To exit press CTRL+C');
          
          channel.bindQueue(q.queue, exchange, key);
          channel.bindQueue(q.queue, exchange, key2);
          channel.bindQueue(q.queue, exchange, key3);
          
          channel.consume(q.queue, function(msg) {
            // Emitting a new message. Will be consumed by the client
            if(msg.fields.routingKey == key){
              //parse the full build process received from the sequencer over the rabbitMQ server on sequencer.report.process.all
              message = JSON.parse(msg.content);
              //modifying the build process to match the data we need on the client side
              message.map((value, i, arr) => {
                value.status="WAITING";
                value.total=value.stepStages.length;
                console.log("total", value);
                value["stepStages"].map((v) => {
                  v.status="WAITING";
                  if(v.type == "MOVE.STATION.WORK" || v.type == "MOVE.ARM.APPROACH" || v.type == "MOVE.ARM.WORK" || v.type == "WORK.DRILL" || v.type == "WORK.FASTEN"){
                    stages.push(v);
                  }else{
                    stages.push(v);
                    newStepStages[newStepStages.push([]) - 1].push(...stages);
                    stages.length = 0;
                  }
                });
                value.stepStages.length = 0;
                value.stepStages.push(...newStepStages);
                newStepStages.length = 0;
              });
              //emit the build process via socketio to all client in room FromBPAll
              socket.emit("FromBPAll", message);
              console.log("message modified : ", message);
            }else if (msg.fields.routingKey == key2){ // Receiving the status of the action in progress
              action = JSON.parse(msg.content); // Parse the message
              console.log("action reçue",action);
              if(action.id == 'begin' || action.id == 'end'){ // Check if beginning/end of sequence
                console.log("reception notification début ou fin de séquence");
                socket.emit("InfoSeq", action.id);
              }else{
                //Change status to "SUCCESS" for the received action
                checkAction(message, action, socket, percentage);
                //Change activeStep if status has been changed for the current step
                if(message[activeStep].status == "SUCCESS" && activeStep < message.length){
                  activeStep++;
                  socket.emit("Percentage", 0);
                  percentage = 0;
                  console.log("activestep : ", activeStep);
                  socket.emit("FromBPAll", message);
                  socket.emit("ActiveStep", activeStep);
                }
                socket.emit("FromBPAdv", action);
              }
            }else if (msg.fields.routingKey == key3){
              activeStep = 0;
              socket.emit("ResetFromBackend", "reset");
              message = [];
            }
          }, {
            noAck: true
          });
          //Connection avec socket.io pour communication avec le frontend
          const socket = io.on("connection", (socket) => {
            console.log("Client is connected");
            socket.emit("FromBPAll", message);
            socket.emit("ActiveStep", activeStep);
            socket.emit("FromBPAdv", action);

            socket.on("ResetFromClient", (a) => {
              activeStep = 0;
              message = "Attente de la Recette";
              socket.emit("FromBPAll", message);
              channel.publish(exchange, key3, Buffer.from("reset"));
            });

            //Called when the client disconnect from the socketio link
            socket.on("disconnect", () => {
              console.log("Client disconnected");
            });
          });
        });
      });
    });
    
  } catch (e) {
    console.error(e);
  }
  server.listen(port, () => console.log(`Listening on port ${port}`));
}

function checkAction(array, action, socket){
  for (const [key, value] of Object.entries(array)) { //loop through the array of objects and get key - value pair
    if(value.status != "SUCCESS"){
      for (const v of value.stepStages) { // Loop through an array of arrays
        for (const [key1, value1] of Object.entries(v)) {  //loop through an array of objects and get key1 - value pair
          if(action.id == value1.id){
            if(value.stepStages.indexOf(v) == (value.stepStages.length - 1)){
              value.status = "SUCCESS";
            }
            percentage+=1/value.total;
            socket.emit("Percentage", percentage);
            return value1.status = "SUCCESS";
          }
        }
      }
    }
  }
}