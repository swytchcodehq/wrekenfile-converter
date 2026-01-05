# Wrekenfile v1.2

## Wrekenfile

1. The accepted names for the file are `Wrekenfile.yaml` or `Wrekenfile.yml` .


  

```yaml
# =========================================================
#
# Wrekenfile
# Metadata file for the given library to be fed to Wreken
#
# =========================================================

# Wrekenfile version
#
# Putting version information helps generate and verify the correct schema of the 
# Wrekenfile

VERSION: "1.2"



# ==========================================================
#
# List of available programming interfaces for the library
# This can include `INTERFACES` and `INIT`
#
# ==========================================================


# INIT functions

# These functions are called at the top to initialize the library or
# functions which are required as a dependency for the library initialization 
# and functions which are out of scope for the library e.g `current date` required as
# a param in library initialization
#
# `INIT` functions are called in order of their declarations
#
# If no `INIT` functions are provided, `INTERFACES` can be called directly
# without `lib` object. e.g
# With `INIT`: `lib.method_name(...params)`
# Without `INIT`: `function_name(...params)`

INIT:

  # `DEFAULTS` is a special block in `INIT`. Here, you define defaults for function
  # calls. These are global variables. You can also define `DEFAULTS` inside the   
  # `INTERFACES`
  #
  # The `DEFAULTS` inside `INTERFACES` take precedence over global `DEFAULTS`
  # `DEFAULT` values can be overwritten anytime during code generation

  DEFAULTS:
    - userid: 1
    - cartid: 1
    - amount: 100.00
    - bearer_token: "BEARER abcd"
    - some_val: "SOME VALUE"


  current-date:
    DESC: "Generate a timestamp"
    INTERFACE: Date()
    ASYNC: false
    TYPE: sdk
    RETURNS:
      - RETURNTYPE: TIMESTAMP
        RETURNNAME: currentDate

    
  initiate-library:
    DESC: "Initiate the library"
    INTERFACE: Library(currentDate)
    ASYNC: false
    TYPE: sdk
    RETURNS:
      - RETURNTYPE: STRUCT(ABC)
        RETURNNAME: lib



# INTERFACES

# Available programming interfaces
# Order agnostic

INTERFACES:

  # General internal function

  nonce:
    DESC: "Generate one unique key for the transactions"
    INTERFACE: nonce()
    ASYNC: false
    RETURNS:
      - RETURNTYPE: STRING, REQUIRED
        RETURNNAME: nonceVal


  make-payment:
    DESC: "Make a payment for a product"
    INTERFACE: make_payment(userid, cartid, amount, nonce, cardtype)
    ASYNC: true
    INPUTS:
      - name: userid
        type: INT 
        required: TRUE
      - name: cardid
        tye: INT
        required: TRUE
      - name: amount
        type: FLOAT 
        required: TRUE
      - name: nonce
        type: STRING 
        required: TRUE
      - name: cardtype 
        type: STRING
        required: FALSE
    DEFAULTS:
      - cardtype: "Master"
      - amount: 100.00
      - nonce: nonceVal
    RETURNS: 
      - RETURNTYPE: STRUCT(ABC)
        RETURNNAME: payment_status


  payment-details-by-id:
    DESC: "Get payment details by ID"
    INTERFACE: get_paymentDetails_by_id(userid, paymentid)
    ASYNC: false
    INPUTS:
      - name: userid 
        type: INT 
        required: TRUE
      - name: paymentid 
        type: STRING
        required: FALSE
    DEFAULTS:
      - paymentid: payment_status.uid
    RETURNS: 
      - RETURNTYPE: []STRUCT(ABC)

  # POST requests

  user-payment-details:
    DESC: "Get details of user's specific payment"
    ENDPOINT: http://library.api/payment-details
    HTTP:
      METHOD: "POST"
      HEADERS: 
        - Authorization: bearer_token
        - CustomHeader: some_val

      # `BODYTYPE` can be raw, form-data, x-www-form-urlencoded, graphql

      BODYTYPE: "RAW"
    INPUTS:
      - name: userid 
        type: INT
        required: TRUE
    RETURNS: 
      - RETURNTYPE: []STRUCT(ABC)

  # GET Requests

  payment-methods:
    DESC: "Get all available payment methods"
    ENDPOINT: http://library.api/payment-methods
    HTTP:
      METHOD: "GET"
      HEADERS:
        - Authorization: bearer_token
        - CustomHeader: some_val
    RETURNS: 
      - RETURNTYPE: []STRUCT(ABC)



# ==========================================================
#
# Basic test cases for the library with Wrekenfile
# Any specific input and output value should be enclosed within ticks(``)
#
# ==========================================================

TESTS:
  NLP:
    - Generate code to make a payment using `Visa` card and get the payment details for the generated `paymentid`
    - Get all payment methods
```

  

## Expected output for the Tests

The output from the tests are sent as an API response

  

#### Test 1

```javascript
/*
 * ==================================================================================
 * Generate code to make a payment using `Visa` card and get the payment details for 
 * the generated `paymentid`
 * ==================================================================================
*/


// Initiate Library

const currentDate = new Date()
const lib = new Library(currentDate)

// Process NLP
const nonceVal = lib.nonce()

// Note: 
// 1. The values picked from `DEFAULTS`
// 2. Also, note how `Visa` was assigned instead of Default `Master`
// 3. Lastly, see how the required `nonceVal` value was interpreted and the function 
// call was made above

const payment_status = await lib.make_payment(1, 1, 100.00, nonceVal, "Visa")

// If no `RETURNNAME` is specified in the Wrekenfile, just `console.log` the output
console.log(lib.get_paymentDetails_by_id(1, payment_status.uid))
```

  

#### Test 2

```javascript
/*
 * ===================================
 * Get all payment methods
 * ===================================
*/

// Initiate Library
// Note: Irrespective of the fact that we don't need the values in an API, but since 
// `INIT` was defined, we initialize the library

const currentDate = new Date()
const lib = new Library(currentDate)

// Process NLP
const response = await fetch("http://library.api/payment-methods");
const payments = await response.json();
console.log(payments);
```

# Wrekenfile Documentation

# About Wrekenfile

  

Wrekenfile is a universal configuration specification for APIs and SDKs that helps generate one shot code workflow for the library. The configuration specification is programming language agnostic and it's a `yaml` file that contains the `input`, `output`, `method descriptions`, `http methods`, `default values` and `custom variable` definitions of a library.

  

The intention is to use the Wrekenfile to generate a code workflow for the library by using a combination of available functions/APIs available in the specification. Users should be able to write their requirements as a LLM prompt, and the AI should understand the components in a Wrekenfile and generate a working code workflow for them.

  

## Main Blocks

  

Wrekenfile is divided into 4 important blocks, namely

  

### 1\. VERSION

  

It describes the current version of the Wrekenfile. Putting version information together helps generate and verify the correct schema of the specification. This should be included in the top, like

  

```plain
VERSION: "1.2"
```

  

### 2\. INIT

  

Contains the default values for constants and environment variables. Also includes definitions for external dependent functions and a call to the entry function of the library. Here is an example of INIT block

  

```plain
INIT:
    DEFAULTS:
        - userid: 1
        - cartid: 1
        - amount: 100.00
        - bearer_token: "BEARER abcd"
        - some_val: "SOME VALUE"

    EXT:
        DESC: "Generate a timestamp"
        INTERFACE: Date()
        ASYNC: false
        RETURNS:
            - RETURNTYPE: TIMESTAMP
              RETURNVAR: currentDate

    ENTRY:
        DESC: "Initiate the library"
        INTERFACE: Library(currentDate)
        ASYNC: false
        INPUTS:
            - name: currentDate
              type: INT
              required: TRUE
        RETURNS:
            - RETURNTYPE: STRUCT(LIBRARY)
              RETURNVAR: library
```

  

Section description for the block above

  

##### DEFAULTS

  

Defaults contain the values for environment variables or constants to be used later in the Wrekenfile. These values can be overridden by values mentioned inside the Methods (to be explained later)

  

##### EXT

  

This section defines any external function and its return types. These functions should be independent of any other dependencies. If there is a dependency on a variable or value, it should be defined in _DEFAULTS_ rather than writing a different function for the same. In the example above, the _EXT_ contain the following [Sections (defined here in detail)](http://#sections)

  

1. `SUMMARY` provides a summary of external function description
2. `DESC` provides a detailed description of the method
3. `INTERFACE` defines how you can call the external function. Remember, this function shouldn't have an input dependency from another function. If so, the values should be defined in _DEFAULTS_ and passed as function arguments.
4. `ASYNC` is false and tells the interface returns immediately.
5. `RETURNTYPE` defines the return data type. It can be a [Primitive value](http://#primitive-types), a [Struct (object)](http://#4-structs) or an Array (primitives or structs)
6. `RETRURNVAR` is the variable name that contains the value of the return from the function.

  

##### ENTRY

  

This defines the starting function, method, or API for the library. e.g., if a library needs an authentication or authorization call before each API, function, or method call, then that should be defined here. Many libraries may not contain the _ENTRY_ block. Also, _ENTRY_ block can be an [Endpoint](http://#endpoint-optional) or an [Interface](http://#interface-optional)

  

The structure of this block is similar to _EXT_ with two distinctions. One being the`INPUTS` section and the other being the `RETURNTYPE`.

  

1. Inputs are _variable-type maps_ that are passed as arguments to the Interface/Endpoint function.
2. The ReturnType above is a Struct (which is a user-defined data type) and its definition **(LIBRARY)** can be found inside the [STRUCTS](http://#4-structs) block

  

### 3\. METHODS

  

These are the functions or methods available for the library. They can be either API definitions or function declarations for the SDKs. Methods also contain _SECTIONS_ that define the input and output values and their types. These returns can also serve as input for other methods in the case of designing an API workflow.

  

#### Sections

  

The building blocks of a Method.

  

##### ALIAS (Mandatory)

  

Alias or Section headers, are just names to identify a method. It should be a programmatic name (similar to variable naming conventions) and can contain only alphanumeric characters, an underscore, and a hyphen. e.g

  

```plain
get-last-4-payment-by-user_id:
```

  

##### SUMMARY (Mandatory)

  

A summary is an important section of a method. Every Method block item should have a summary which the LLM can read to find out what the API or method does. Without a summary, the LLM doesn't get the proper context of the underlying API or method. It's recommended that the summary contain one line on what the function does in a direct commanding tone. e.g

  

```plain
SUMMARY: "Fetch a list of payments for a user_id"
```

  
  

##### DESC (Optional)

  

A description is an optional field for the method and provides more context to the LLM. Description augments what the summary does but provides a lot of other details while considering code generation. e.g

  

```plain
DESC: "Fetch a list of payments for a user_id also displays the payment id and date of their creations. Method can be POST only"
```

  

##### INTERFACE (Optional)

  

A library can be one of an SDK type or an API type. The interface defines the function calls for an SDK. For API types, instead of an Interface, an [_ENDPOINT_](http://#endpoint-optional) is provided

  

These functions can be standalone or have arguments. e.g

  

```plain
INTERFACE: get_paymentDetails_by_id(userid, paymentid)
```

In the above example

  

1. `get_paymentDetails_by_id` should be the name of the actual function/method in the SDK
2. The arguments, `userid` and `paymentid` types are defined later in the _INPUTS_ section. But it should be passed in the same order as expected in the actual SDK function/method
3. Function returns are defined later

##### ASYNC (Optional)
Async accepts a boolean (true/false). When combined with interface, it tells the function returns asynchronous output. By default, if not present, it can be assumed to be false.

##### ENDPOINT (Optional)

  

For the API type of a library, Endpoint is mandatory. Endpoint defines a URL that is called to execute results for an API. To define a BASE URL for all the APIs, please read [w\_base\_url in Keywords section](http://#keywords). `w_base_url` shortens the time needed to switch between various environments and also makes the Endpoints look cleaner.

  

Endpoints can be of the following three types:

  

```plain
#E.g-1 with w_base_url
ENDPOINT: "/payment-details"

#E.g-2 for get/post/put/delete requests with parameters
ENDPOINT: "http://library.api/payment-details?key1=value1&key2=value2"
ENDPOINT: "http://library.api/payment-details/value1/value2"
```

  

In E.g-2 above, if the values are dynamic, they can be defined as described in the [Inputs](http://#inputs) section. However, to make them dynamic, the value parameters need to be wrapped with `{}` and the whole Endpoint needs to be wrapped in a tick `(``)` rather than double quotes `("")`. e.g

  

```plain
ENDPOINT: `http://library.api/payment-details?key1={dynamicValue1}&key2={dynamicValue2}`

ENDPOINT: `http://library.api/payment-details/{dynamicValue1}/{dynamicValue2}`
```

  

##### HTTP (Optional)

  

This section only comes into play when making HTTP requests to an API endpoint. The Http can contain three parameters

  

1. METHOD: The HTTP method to use. e.g, `GET/POST/PUT/DELETE`
2. HEADERS: The HTTP headers to send along with the request. All the HTTP headers are supported here
3. BODYTYPE: Body Type be `raw`, `form-data`, `x-www-form-urlencoded`

  

```plain
HTTP:
    METHOD: "POST"
    HEADERS:
        - Authorization: bearer_token
        - CustomHeader: some_val
        - Content-Type: "application/json"
    BODYTYPE: "raw"
```

  

##### INPUTS (Optional)

  

If any of the interfaces or endpoints require input parameters/arguments, then it is mandatory to define Inputs. Inputs contain the data types that need to be passed along with a function call or HTTP request.

e.g

  

For Interface calls

  

```plain
INPUTS:
    - name: userid
      type: INT 
      required: TRUE
    - name: payment
      type: INT
      required: FALSE
```

  

For URL parameters

  

```plain
INPUTS:
    - name: dynamicValue1
      type: INT
      required: TRUE
    - name: dynamicValue2
      type: STRING
      required: TRUE
```

  

For POST HTTP method request with `BODYTYPE:"raw"`

  

```plain
INPUTS:
    - name: body
      type: STRUCT(WATCHES)
      required: TRUE
```

  

**Note**: For the POST HTTP example, there is a special variable `body` that needs to be defined, and the `Content-Type` header needs to be checked. If `Content-Type: "application/json"`, the body needs to be passed as JSON, if `Content-Type:"text/plain"`, then plain text needs to be passed in the body

  

##### DEFAULTS (Optional)

  

When there is a need to pass a default constant only to a specific Function/API, _DEFAULTS_ inside METHODS can be used. If a Default Constant with the same name is defined in the [INIT](http://#init) block, then the current one will supersede the later one.

  

##### RETURNS (Optional)

  

Returns section defines the return data type and value(s) from the library. It can be one of a [Primitive value](http://#primitive-types), a [Struct (object)](http://#4-structs) or an Array (primitives or structs). Returns contain two sub-sections, namely

  

1. `RETURNTYPE`: Defines the type of data returned.
2. `RETURNVAR`: User defined name of the variable that holds the return from the API/Method. _ReturnVar_ holds significance when being used as an input for another API/Function call while executing a workflow

  

To define an array as a return data type, use a `[]` followed by a Primitive or Struct(name). e.g

  

```plain
# Return type: Primitive
- RETURNTYPE: TIMESTAMP
- RETURNTYPE: STRING

# Return type: Struct
- RETURNTYPE: STRUCT(LIBRARY)

# Return type: Array
- RETURNTYPE: []STRUCT(LIBRARY)
- RETURNTYPE: []STRING
```

  

Simple examples using `Returns`

  

```plain
# E.g-1
RETURNS:
    - RETURNTYPE: STRUCT(LIBRARY)
      RETURNVAR: lib
# E.g-2
RETURNS:
    - RETURNTYPE: []STRING
      RETURNVAR: names
```

  

For _E.g-1_, the return values can be accessed via `lib.surname`, `lib.age` in any other subsequent functions in the workflow. Look for `LIBRARY` struct defined later in the Structs block

  

For _E.g-2_, the return values can be accessed via `names[0]`, `names[1]` in any other subsequent functions in the workflow. They can even be used in a loop

  

### 4\. STRUCTS

  

Structs contain the definition of user-defined objects, or structs. Here, any kind of variable can be defined, which cannot be defined directly by programming language primitive variables. A struct can also refer to another struct internally, which needs to be defined within this block. The order of defining structs doesn't matter

  

```plain
STRUCTS:
    LIBRARY:
        - name: STRING, REQUIRED
        - surname: STRING, REQUIRED
        - age: INT, REQUIRED
        - pets: []STRING, REQUIRED
        - watches: []STRUCT(WATCHES), OPTIONAL

    WATCHES:
        - make: STRING, REQUIRED
        - price: FLOAT, REQUIRED
        - year: INT, OPTIONAL
```

  

## PRIMITIVE TYPES

  

Listed below are the generalized Primitive types for all programming languages.

  

1. `STRING`: can cover VARCHAR, TEXT, STRING, etc
2. `INT`: covers INT, INTEGER, INT32, INT64, BIGINT, NUMBER, etc
3. `FLOAT`: covers FLOAT, FLOAT32, FLOAT64, DOUBLE, DECIMAL, etc
4. `TIMESTAMP`: covers all TIMESTAMP cases
5. `DATE`: covers DATE types
6. `TIME`: covers TIME
7. `BOOL`: also covers BOOLEAN
8. `UNDEFINED`: for static programming languages where user data type is unknown
9. `NULL`: returns/holds nothing
10. `BYTES`: For byte types
11. `ANY`: can take any value
12. `UUID`: Unique string for uuid

  

## KEYWORDS

1. `w_base_url`: can be defined in the [DEFAULTS](http://#defaults). Once defined, it will be prepended to the [ENDPOINT](http://#endpoint-optional). e.g

  

```plain
INIT:
    DEFAULTS:
        - w_base_url: "https://library.api"

METHODS:
    make-payment:
        DESC: "Make a payment for a product"
        ENDPOINT: "/payment-details"
```

  

In the example above, the `w_base_url` variable is defined, and the Endpoint only needs to point to the remaining part of the URL. However, when the API Endpoint is called, the full URL is passed like ([https://library.api/payment-details](https://library.api/payment-details)).

  

**Note**: `w_base_url` shouldn't contain the trailing forward slash (`/`)