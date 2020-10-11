const Twitter = require('twitter');
const { Parser } = require('json2csv');
const fs = require('fs')
// moment gives us better date handling than js built in dates
const moment = require('moment')

// this is the main body of our script, where we call helpers
const args = parseArgs()
const client = setupClient()
getTweets(args.searchterm, args.date)

// this is setting up the twitter client, make sure to put your own keys in here
function setupClient() {
    var client = new Twitter({
        consumer_key: '_',
        consumer_secret: '_',
        bearer_token: '_'
    });

    return client
}

// this parses command line arguments. it uses today if no date is supplied
function parseArgs() {
    const usage = "USAGE: node app.js searchterm date(YYYY-MM-DD)"
    // if there aren't enough args, print out usage string to tell ppl how to use this
    if (process.argv.length < 3) {
        console.log(usage)
        process.exit(1)
    }

    // use current datetime if no date is supplied
    let date = moment()
    if (process.argv.length > 3) {
        // if a date is supplied, try to parse it. if parsed, use it, otherwise use current as set above
        let parsedDate = moment(process.argv[3], 'YYYY-MM-DD')
        if (parsedDate.isValid()) {
            date = parsedDate
        }
    }

    return { searchterm: process.argv[2], date: date}
}

function clearFile() {
    fs.truncate('tweets.csv', 0, () => {})
}

// we will append data to the file in batches to avoid running out of memory trying to store it all locally
function appendToFile(data) {
    try {
        const fields = [ 'created_at', 'text' ]
        const opts = { fields }
        const parser = new Parser(opts)
        // const parser = new Parser() // use this instead of above line to get all fields
        const csv = parser.parse(data);
        fs.appendFile('tweets.csv', csv, () => {})
    } catch (err) {
        console.error(err);
    }
}

// this actually fetches the tweets and dumps them into a csv
function getTweets(searchterm, date){
    // we're gonna get all tweets from date to the day before date, so tomorrow will store the maximum date
    const tomorrow = moment(date).add(1, 'days').utcOffset(0)

    // this pulls max id out off the next_results field, which looks something like "next_results": "?max_id=967574182522482687&q=nasa&include_entities=1&result_type=popular"
    const getMaxId = (nextResults) => {
        return nextResults.split("max_id=")[1].split("&")[0];
    }

    // function to continually get next set recursively until we've gotten everything from date. we aren't calling it here, just defining it
    const getNextSet = (maxId) => {
        return client.get('search/tweets', {q: searchterm, max_id: maxId, count: 100}).then(tweets => {
            // make sure we actually received stuff
            if (!tweets || !tweets.statuses || tweets.statuses.length == 0) {
                console.log('failed to get tweets!')
                console.log(tweets)
                return
            }

            // grab the last tweet in the array, it'll have the earliest date
            const lastTweet = tweets.statuses[tweets.statuses.length - 1]
            const lastTweetDate = moment(lastTweet.created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY').utcOffset(0)

            // if the last tweet is from a day before date, it's out of range
            if (lastTweetDate.isBefore(date, 'day')) {
                let aggregatedTweets = []
                // instead of pushing all of them, push each one that isn't before date
                tweets.statuses.forEach(tweet => {
                    const tweetDate = moment(tweet.created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY').utcOffset(0)
                    if (!tweetDate.isBefore(date, 'day')) {
                        aggregatedTweets.push(tweet)
                    }
                })
                appendToFile(aggregatedTweets)
            } else {
                // otherwise we need to fetch another set. add all these tweets to our list, and run this function again to get the next set
                appendToFile(tweets.statuses)
                return getNextSet(getMaxId(tweets.search_metadata.next_results))
            }
        })
    }

    // this is where we do the initial fetch and then trigger our getNextSet function defined above
    client.get('search/tweets', {q: searchterm, until: tomorrow.format('YYYY-MM-DD'), count: 100})
    .then((tweets) => {
        // make sure we actually received stuff
        if (!tweets || !tweets.statuses || tweets.statuses.length == 0) {
            console.log('failed to get tweets!')
            console.log(tweets)
            return
        }
        // clear file the first time we run
        clearFile()

        appendToFile(tweets.statuses)
        
        // figure out the id for next set
        let maxId = getMaxId(tweets.search_metadata.next_results);

        // fetch the next set (which will run in a loop fetching all sets for the day)
        getNextSet(maxId).then(() => {
            console.log('finished')
        })
    }).catch((err) => {
        console.log('failed!')
        console.log(err)
        return
    })
 
}


