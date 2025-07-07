export const uploadImageToCloud = async (request, response) => {
  try {
    //TODO: -> UPLOAD IMAGE TO CLOUD AND RETURN THE IMAGE URL TO THE RESPONSE
    console.log("UPload image controler");

  } catch (error) {
    console.log("Error in uploading image");
    return response.json(500).json({
      success: false,
      message: "Failed to upload Image to Cloud"
    })
  }
}