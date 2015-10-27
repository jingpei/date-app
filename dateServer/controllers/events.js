var URL = require('url');

var errors = require('../models/errors');
var User = require('../models/user');
var Tag = require('../models/tag');
var Event = require('../models/event');
var EventSQL = require('../models/eventSQL');
var VenueSQL = require('../models/venueSQL');
var Promise = require('bluebird');
var config = require('../secret/config');
var user = require('../models/user');


var clientID = process.env.FS_ID|| config.clientID;
var clientSecret = process.env.FS_SECRET || config.clientSecret;
var foursquare = require('node-foursquare-venues')(clientID, clientSecret);

function getDateURL(date) {
  return '/dates/' + encodeURIComponent(date.datename);
}


/**
 * POST /events/:eventname {eventname, description...}
 */
exports.create = function(req, res, next) {
  Event.create({
    eventname: req.body.eventname,
    description: req.body.description
  }, function(err, tag) {
    if (err) {
      res.sendStatus(404);
    }
    res.redirect('/users');

  });
};


/**
 * DELETE /events/:eventname
 */
exports.del = function(req, res, next) {
  Event.get(req.params.eventname, function(err, event) {
    // TODO: Gracefully handle "no such user" error somehow.
    // E.g. redirect back to /users with an info message?
    if (err) return next(err);
    event.del(function(err) {
      if (err) return next(err);
      res.redirect('/users');
    });
  });
};

/**
 * POST /events/:eventname/tag {tagname}
 */
exports.tag = function(req, res, next) {

  Event.get(req.params.eventname, function(err, event) {
    // TODO: Gracefully handle "no such user" error somehow.
    // This is the source user, so e.g. 404 page?
    if (err) return next(err);
    Tag.get(req.body.tagname, function(err, tag) {
      // TODO: Gracefully handle "no such user" error somehow.
      // This is the target user, so redirect back to the source user w/
      // an info message?
      if (err) return next(err);
      event.tag(tag, function(err) {
        if (err) return next(err);
        res.redirect('/users');
      });
    });
  });
};

/**
 * POST /events/:eventname/untag {tagname}
 */
exports.untag = function(req, res, next) {
  Event.get(req.params.eventname, function(err, event) {
    // TODO: Gracefully handle "no such user" error somehow.
    // This is the source user, so e.g. 404 page?

    if (err) return next(err);
    Tag.get(req.body.tagname, function(err, tag) {

      // TODO: Gracefully handle "no such user" error somehow.
      // This is the target user, so redirect back to the source user w/
      // an info message?

      if (err) return next(err);
      event.untag(tag, function(err) {
        if (err) return next(err);
        res.redirect('/users');
      });
    });
  });
};


exports.getMatchingEvents = function(req, res, next) {
  console.log('Routing correctly');
  Event.getMatchingEvents(req.body.profile, function(err, events) {
    if (err) return next(err);
    exports.getFoursquareVenues(events, res);
    // res.send(events);
  });
};

//Returns the tags that correspond to the user in the getMatchingEventsNoRest request.
var getMyUserTags = function(myUser){
  console.log("Getting the user: ", myUser.username);
  var userPromise = new Promise(function(resolve, reject){
    user.get(myUser.username, function(err, user){
      if(err){
        console.log("there was an error getting the user in neo4j");
        reject(err);
      } else {
        resolve(user);
      }
    });
  });
  userPromise.then(function(user){
    user.username = myUser.username;
    return new Promise(function(resolve, reject){
      var myTags = user.getAllTags(function(err, tags){
        if(err){
          console.log("there was an error getting the user tags in neo4j");
          reject(err);
        } else {
          resolve(tags);
        }
      });
    });
  });
};

//The rules for defining an event's score are:
//  If the event includes a tag from a questionairre, it gets a point.
//  If the user has liked a tag from the questionairre, it gets points
//   equivalent to the number of times the user has liked that tag.
//  TODO: Weight the user likes.
var defineEventTagScore = function(event, tags, userTags){
  //console.log("Event: ", event);
  var similarTags = {};
  var eventScore = 0;
  for(var i = 0; i < event.myTags.length; i ++){
    //console.log(event.myTags[i]);
    if(tags[event.myTags[i]._node.properties.tagname]){
      similarTags[event.myTags[i]._node.properties.tagname] = 1;
    }
  }
  if(userTags){
    for(i = 0; i < userTags.length; i ++){
      if(similarTags[userTags[i]._node.properties.tagname]){
        similarTags[key]++;
      } else {
        similarTags[key] = 1;
      }
      for(j = 0; i < event.myTags.length; j++){
        //console.log(event.myTags[i]);
        if(event.myTags[j]._node.properties.tagname === userTags[i]._node.properties.tagname){
          if(similarTags[event.myTags[i]._node.properties.tagname]){
            similarTags[event.myTags[i]._node.properties.tagname]++;
          } else {
            similarTags[event.myTags[i]._node.properties.tagname] = 1;
          }
        }
      }
    }
  }
  for(var tag in similarTags){
    eventScore += similarTags[tag];
  }
  event.score = eventScore;
};

//utility function to sort events based on score.
var compareEventScores = function(eventA, eventB){
  if (eventA.score < eventB.score){
    return -1;
  } else {
    if(eventA.score === eventB.score){
      return 0;
    } else {
      return 1;
    }
  }
};

/**
 * returns the matching events based on a list of tags.
 */
exports.getMatchingEventsNoRest = function(tags, req, res) {
  console.log('Routing correctly. The body: ', req.body);

  var myUser = {
    username: req.body.userName
  };
  var userPromise = new Promise(function(resolve, reject){
    resolve(getMyUserTags(myUser));
  });

  //Get all of the user's tags.
  userPromise.then(function(userTags){
    console.log("User's Tags: ", userTags);
    //Get the events that match the questionairre tags
    Event.getMatchingEvents(tags, function(err, events) {
      var promises = [];
      if (err) {
        return res.status(500).send(err);
      }
      if(events.length === 0){
        var ideas = {
          ideaArray: [
            {idea: "Play frisbee at Mission Dolores Park", liked: 0, disliked: 0, imgUrl: 'https://irs3.4sqi.net/img/general/960x720/17160664_1pVXH9Lf1AGEF9GiADPhnKDn05nHwEazTCk8XdZr_OQ.jpg'},
            {idea: "Get schwasted at Bourbon & Branch", liked: 0, disliked: 0, imgUrl:'https://irs2.4sqi.net/img/general/960x720/44636481_XKzA8WwCQan1LueBpfLoHrVDC1rUGfIb6rtq4zMx5fU.jpg' },
            {idea: "Kiss in the middle of the Golden Gate Bridge", liked: 0, disliked: 0, imgUrl: 'https://irs2.4sqi.net/img/general/612x612/21220925_aayAh4Nd5fVrcfYx_i1mQ6vKFXhAVqNvDEHqT0JVvl4.jpg' }
          ]
        };
        return res.status(200).send(ideas);
      } else {
        var limit = 3;
        //Attach the event tags to the event object.
        for(var i = 0; i < events.length; i ++){
          var tagPromise = new Promise(
          function(resolve, reject){
            events[i].getAllTags(function(err, tags){
              if(err){
                reject(err);
              } else {
                resolve(tags);
              }
            });
          });
          promises.push(tagPromise);
        }
        Promise.all(promises).then(
          function(theTags){
            console.log("Events length", events.length);
            //Score the tags based on the scoring algorithm.
            for(var i = 0; i < events.length; i ++){
              defineEventTagScore(events[i], tags, userTags);
            }
            events.sort(compareEventScores);
            exports.getFoursquareVenues(events, res, limit);
          });
      }
    });
  });
};

exports.getFoursquareVenues = function(events, res, limit) {
  var ideas = { ideaArray: [] };
  var promises = [];
  var indices = [];
  var j = 0;
  // Randomly select x (limit parameter of this function) number of indices in events input
  // This will choose the categoryId we will query foursquare with
  // These indices should be UNIQUE
  for(var i = 0; i < events.length; i ++){
    if(events[i].score !== events[j].score || i === events.length - 1){
      if(i-j+indices.length < limit){
        for(var k =j; k < i; k++){
          indices.push(k);
          pushedEvents++;
        }
      }
      else{
        while(indices.length !== limit){
          var generateIndex = Math.floor(Math.random() * (i-j))+j;
          if(indices.indexOf(generateIndex) === -1){
            indices.push(generateIndex);
          }
        }
      }
      j = i;
    }
  }
  // Create a unique foursquare search object using each of the randomly chosen categoryIds
  // Also push promise functions to array which will run all the foursquare queries
  for(var i = 0; i < indices.length; i++){
    console.log('Search Index: ' + indices[i] + ', Event Category: ' + events[indices[i]]._node.properties.venueCategory);
    console.log('Specific event');
    console.log(events[indices[i]]._node.properties);
    var searchObj = {
      ll: '37.78,-122.41',
      categoryId: events[indices[i]]._node.properties.fsCategory,
      intent: 'browse',
      radius: '5000'
    };
    promises.push(exports.venueSearch(searchObj, indices[i], events, ideas));
  }

  // Promise.all is a function which will take in an array and runs all promise functions in the array
  // This allows us to have x number of promises run as though they were chained with .then
  // Now we can run a non-hardcoded number of promises!
  Promise.all(promises)
  .then(function(ideas) {
    // Since we resolve all the promises at once
    // We need to take the result of the promise that is last run since it contains all the ideas
    res.status(200).send(ideas[ideas.length-1]);
  });

};

/** Promise helper function for querying foursquare based on an input searchObj
* Also takes in:
*  the eventIndex and events object to create the random idea string
*  the ideas object which is the master list of all ideas we want to return
*/
exports.venueSearch = function (searchObj, eventIndex, events, ideas) {
  var venuePromise = new Promise(function(resolve, reject) {
    foursquare.venues.search(searchObj, function(err, result) {
      if (err) {
        console.log("There was an error sanitizing the venues!", err);
        reject(err);
      } else {
        var tempVenues = result.response.venues;
        console.log("The number of venues attached to this event is: ", tempVenues.length);
        var venues = exports.removeBunkVenues(tempVenues);
        var venueIndex = Math.floor(Math.random() * venues.length);
        var venueId = venues[venueIndex].id;
        exports.getFoursquareImageForVenue(venueId, {})
        .then(function(venueImage) {
          var idea = {idea: events[eventIndex]._node.properties.event + ' ' + events[eventIndex]._node.properties.preposition + ' ' + venues[venueIndex].name, liked: 0, disliked: 0, imgUrl: venueImage};
          ideas.ideaArray.push(idea);
          resolve(ideas);
        });
      }
    });
  });
  return venuePromise;
};


// This function returns venues that have a checkinsCount of over 30.
// This increases the chance that the venue will have a bestPhoto to show to the user.
exports.removeBunkVenues = function (venues) {
  var newVenues = [];
  for (var i = 0; i < venues.length; i++) {
    if (venues[i].stats.checkinsCount > 30) {
      newVenues.push(venues[i]);
    }
  }
  console.log("Venues left after debunking: ", newVenues.length);
  if (newVenues.length !== 0 && newVenues){
    return newVenues;
  } else {
    console.log("Here's the 0th venue: ", venues[0].name);
    return [venues[0]];
  }
};

// This function grabs the bestPhoto from the foursquare venue search. If there's no photo, set it to null.
exports.getFoursquareImageForVenue = function (venueId, searchObj) {
  var imagePromise = new Promise(function(resolve, reject) {
    foursquare.venues.venue(venueId, searchObj, function(err, result) {
      if (err) {
        console.log("There was an error getting the foursquare image", err);
        reject(err);
      } else {
        var venueImage;
        if (result.response.venue.hasOwnProperty('bestPhoto')) {
          venueImage = result.response.venue.bestPhoto.prefix + result.response.venue.bestPhoto.width + 'x' + result.response.venue.bestPhoto.height + result.response.venue.bestPhoto.suffix;
        } else {
          venueImage = null;
        }
        resolve(venueImage);
      }
    });
  });
  return imagePromise;
};

/*--------------------SQL---------------*/

exports.createEventSQL = function(req, res, next){
  console.log(req.body.eventID);

  EventSQL.post(req.body.eventID, req.body.eventName, res);
};

exports.createVenueSQL = function(req, res, next){
  console.log(req.body.venueID);

  VenueSQL.post(req.body.venueID, req.body.venueName, req.body.venueHours, req.body.venueLongitude, req.body.venueLatitude, req.body.venueAddress, res)
}

